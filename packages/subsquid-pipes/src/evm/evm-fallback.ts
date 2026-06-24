import type { Rpc } from '@subsquid/evm-rpc'
import { cast } from '@subsquid/util-internal-validation'

import {
  BatchContext,
  BlockCursor,
  FallbackPolicy,
  FallbackSource,
  FallbackUnderlyingSource,
  MetricsServer,
  PortalBatch,
  createDefaultLogger,
  cursorFromHeader,
  extractRollbackChain,
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

  return {
    name,
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

      for await (const batch of portal.getStream(query, { finalized: options.finalized ?? true })) {
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
    if (cfg.type === 'portal') {
      return evmPortalReadSource({
        name: cfg.name ?? `portal-${i}`,
        portal: cfg.portal,
        fields: options.fields,
        request: options.request,
        from: options.from,
        to: options.to,
        finalized: options.finalized,
      })
    }

    return lazyRpcSource(cfg.name ?? `rpc-${i}`, cfg, options)
  })

  const fallback = new FallbackSource(underlying, options.policy)
  if (options.metrics) {
    registerFallbackMetrics(options.metrics.metrics, fallback)
  }

  return fallback
}

/**
 * An RPC fallback source whose `@subsquid/evm-rpc` dependency is loaded **lazily** — only when the
 * source is actually read (i.e. it becomes active). A multi-Portal fallback therefore never
 * imports the RPC stack, and a misconfigured RPC source fails with a clear, actionable error
 * instead of an opaque module-not-found at startup. (`@subsquid/evm-rpc` + `evm-normalization` are
 * optional and currently unpublished — see EXECUTION_STATUS.md.)
 */
function lazyRpcSource<F extends FieldSelection>(
  name: string,
  cfg: Extract<EvmFallbackSourceConfig<F>, { type: 'rpc' }>,
  options: EvmFallbackOptions<F>,
): FallbackUnderlyingSource<Block<F>[]> {
  let inner: { read(cursor?: BlockCursor): AsyncIterable<PortalBatch<Block<F>[]>> } | undefined

  return {
    name,
    read: async function* (cursor?: BlockCursor): AsyncIterable<PortalBatch<Block<F>[]>> {
      if (!inner) {
        let mod: typeof import('./evm-rpc-source.js')
        try {
          mod = await import('./evm-rpc-source.js')
        } catch {
          throw new Error(
            `RPC fallback source "${name}" requires the optional "@subsquid/evm-rpc" and ` +
              `"@subsquid/evm-normalization" packages — install them to use RPC sources.`,
          )
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
      }

      yield* inner.read(cursor)
    },
  }
}
