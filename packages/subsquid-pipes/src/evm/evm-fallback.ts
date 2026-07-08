import type { Rpc } from '@subsquid/evm-rpc'
import { cast } from '@subsquid/util-internal-validation'

import {
  BatchContext,
  BlockCursor,
  CapabilityProbeOptions,
  FallbackPolicy,
  FallbackSource,
  FallbackUnderlyingSource,
  MetricsServer,
  PortalBatch,
  createDefaultLogger,
  cursorFromHeader,
  extractRollbackChain,
  makeCapabilityProbe,
  noopMetricsServer,
  registerFallbackMetrics,
} from '~/core/index.js'
import { Span } from '~/core/profiling.js'
import { ApiDataset } from '~/portal-client/client.js'
import { PortalClient, PortalClientOptions } from '~/portal-client/index.js'
import { Block, DataRequest, FieldSelection, getBlockSchema } from '~/portal-client/query/evm.js'

import type { RpcMethodOptions } from './evm-rpc-source.js'
import { withRequiredFields } from './rpc/decode.js'

/** One EVM source in a fallback. Both kinds share the same `fields` + `request`. */
export type EvmFallbackSourceConfig<F extends FieldSelection> =
  | { type: 'portal'; name?: string; portal: string | PortalClientOptions | PortalClient }
  | { type: 'rpc'; name?: string; rpc: Rpc; method?: RpcMethodOptions; strideSize?: number; strideConcurrency?: number }

export interface EvmFallbackOptions<F extends FieldSelection> {
  fields: F
  request: DataRequest
  from: number
  to?: number
  finalized?: boolean
  sources: EvmFallbackSourceConfig<F>[]
  policy?: FallbackPolicy
  /**
   * Attach a generic capability probe to every source (default `true`): a source counts as
   * `healthy` only once it confirms it can serve the configured data at the indexing frontier —
   * catching a reachable-but-incapable source (trace/`debug_` disabled, pruned state, a Portal
   * answering HTTP 400 to a type-valid query) before a switch-up promotes it. Pass `false` to govern
   * health by liveness alone, or `{timeoutMs}` to tune the probe.
   */
  capabilityProbe?: boolean | CapabilityProbeOptions
  /** When provided, fallback health/switch gauges are registered on this metrics server (§4). */
  metrics?: MetricsServer
}

/**
 * A Portal source adapter that exposes the fallback's `read(cursor)` contract: it fetches raw
 * blocks from the Portal and casts them with the same `getBlockSchema` the Portal source uses, so
 * its output matches the RPC source's. A `ForkException` propagates from the Portal client
 * unchanged (it is already Pipes' `ForkException`).
 */
export function evmPortalReadSource<F extends FieldSelection>(
  options: { name?: string; portal: string | PortalClientOptions | PortalClient } & Omit<
    EvmFallbackOptions<F>,
    'sources' | 'policy'
  >,
): FallbackUnderlyingSource<Block<F>[]> {
  const portal =
    options.portal instanceof PortalClient
      ? options.portal
      : new PortalClient(typeof options.portal === 'string' ? { url: options.portal } : options.portal)

  const fields = withRequiredFields(options.fields)
  const schema = getBlockSchema(fields)
  const name = options.name ?? 'portal'
  const logger = createDefaultLogger({ id: name })
  const metrics = noopMetricsServer().metrics
  const rawQuery = { type: 'evm', fields: options.fields, ...options.request }

  const finalized = options.finalized ?? true

  return {
    name,
    // Independent head poll (no stream) that powers staleness/lag detection + standby liveness.
    getHead: async (): Promise<BlockCursor | undefined> => {
      const head = await portal.getHead({ finalized })
      return head ? { number: head.number, hash: head.hash } : undefined
    },
    read: async function* (cursor?: BlockCursor): AsyncIterable<PortalBatch<Block<F>[]>> {
      const from = cursor ? cursor.number + 1 : options.from
      const query: any = {
        type: 'evm',
        fields,
        fromBlock: from,
        toBlock: options.to,
        ...options.request,
        parentBlockHash: cursor?.hash,
      }

      for await (const batch of portal.getStream(query, { finalized })) {
        const data = batch.blocks.map((raw) => cast(schema, raw)) as unknown as Block<F>[]
        if (data.length === 0) continue

        const current = cursorFromHeader(data[data.length - 1] as any)
        const finalized = batch.head.finalized
          ? { number: batch.head.finalized.number, hash: batch.head.finalized.hash }
          : undefined

        const ctx: BatchContext = {
          id: name,
          profiler: Span.root('batch', false),
          metrics,
          logger,
          stream: {
            dataset: {} as ApiDataset,
            head: { finalized, latest: current },
            state: {
              initial: from,
              last: current.number,
              current,
              rollbackChain: extractRollbackChain({ blocks: data as any, head: finalized }),
            },
            query: { url: portal.getUrl?.() ?? '', hash: '', raw: rawQuery },
          },
          batch: {
            blocksCount: data.length,
            bytesSize: batch.meta.bytes,
            requests: batch.meta.requests,
            lastBlockReceivedAt: batch.meta.lastBlockReceivedAt,
          },
        }

        yield { data, ctx }
      }
    },
  }
}

/**
 * Build a {@link FallbackSource} over an ordered list of EVM sources (Portal and/or RPC), all
 * sharing one field selection + request so they produce identical output. Drop-in for a single
 * Portal stream — same `AsyncIterable<PortalBatch> + pipeTo`.
 */
export function createEvmFallback<F extends FieldSelection>(
  options: EvmFallbackOptions<F>,
): FallbackSource<Block<F>[]> {
  const underlying: FallbackUnderlyingSource<Block<F>[]>[] = options.sources.map((cfg, i) => {
    const source =
      cfg.type === 'portal'
        ? evmPortalReadSource({
            name: cfg.name ?? `portal-${i}`,
            portal: cfg.portal,
            fields: options.fields,
            request: options.request,
            from: options.from,
            to: options.to,
            finalized: options.finalized,
          })
        : lazyRpcSource(cfg.name ?? `rpc-${i}`, cfg, options)

    if (options.capabilityProbe === false) return source

    return {
      ...source,
      probeCapability: makeCapabilityProbe(
        source,
        options.capabilityProbe === true ? undefined : options.capabilityProbe,
      ),
    }
  })

  const fallback = new FallbackSource(underlying, options.policy)
  if (options.metrics) {
    registerFallbackMetrics(options.metrics.metrics, fallback)
  }

  return fallback
}

const RPC_PEERS = ['@subsquid/evm-rpc', '@subsquid/evm-normalization']

/**
 * If `e` is a module-not-found for one of the optional RPC peers, return an actionable error naming
 * both peers; otherwise return `e` unchanged. Matches the missing module by its exact quoted name,
 * so a module-not-found for a *different* module (a broken transitive dep) — and any other fault
 * thrown while loading the RPC stack (a syntax/init error) — surfaces as-is rather than being masked
 * as "peers missing". Handles both the ESM (`ERR_MODULE_NOT_FOUND`) and CJS (`MODULE_NOT_FOUND`)
 * loader codes, since the package ships both builds.
 */
export function translateMissingRpcPeer(e: unknown, sourceName = 'rpc'): unknown {
  const err = e as NodeJS.ErrnoException
  const isModuleNotFound = err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND'
  if (isModuleNotFound && RPC_PEERS.some((p) => err.message?.includes(`'${p}'`))) {
    return new Error(
      `RPC fallback source "${sourceName}" requires the optional peer dependencies ` +
        `"${RPC_PEERS[0]}" and "${RPC_PEERS[1]}" — install them to use RPC sources, or use only 'portal' sources.`,
    )
  }
  return err
}

/**
 * An RPC fallback source whose `@subsquid/evm-rpc` dependency is loaded **lazily** — only when the
 * source is actually read (i.e. it becomes active). A multi-Portal fallback therefore never
 * imports the RPC stack, and a misconfigured RPC source fails with a clear, actionable error
 * instead of an opaque module-not-found at startup. (`@subsquid/evm-rpc` + `evm-normalization` are
 * declared as optional peer dependencies — a Portal-only consumer never installs them.)
 */
function lazyRpcSource<F extends FieldSelection>(
  name: string,
  cfg: Extract<EvmFallbackSourceConfig<F>, { type: 'rpc' }>,
  options: EvmFallbackOptions<F>,
): FallbackUnderlyingSource<Block<F>[]> {
  let inner:
    | {
        read(cursor?: BlockCursor): AsyncIterable<PortalBatch<Block<F>[]>>
        getHead(): Promise<BlockCursor | undefined>
      }
    | undefined

  const load = async () => {
    if (inner) return inner
    let mod: typeof import('./evm-rpc-source.js')
    try {
      mod = await import('./evm-rpc-source.js')
    } catch (e) {
      throw translateMissingRpcPeer(e, name)
    }
    inner = new mod.EvmRpcSource({
      id: name,
      rpc: cfg.rpc,
      fields: options.fields,
      request: options.request,
      from: options.from,
      to: options.to,
      finalized: options.finalized,
      method: cfg.method,
      strideSize: cfg.strideSize,
      strideConcurrency: cfg.strideConcurrency,
    })
    return inner
  }

  return {
    name,
    // Head-polling a standby RPC source loads the RPC stack — that is fine/desirable: it is exactly
    // when we want to confirm the source is loadable and viable before switching up to it.
    getHead: async () => (await load()).getHead(),
    read: async function* (cursor?: BlockCursor): AsyncIterable<PortalBatch<Block<F>[]>> {
      yield* (await load()).read(cursor)
    },
  }
}
