import { isForkException, PortalClient, PortalClientOptions } from '~/portal-client/index.js'
import { last } from '../internal/array.js'
import { createPortalCache, PortalCacheOptions } from '../portal-cache/portal-cache.js'
import { Logger } from './logger.js'
import { createMetricsServer, Metrics, MetricsServer } from './metrics-server.js'
import { Profiler, Span } from './profiling.js'
import { ProgressState, StartState } from './progress-tracker.js'
import { hashQuery, QueryBuilder } from './query-builder.js'
import { Target } from './target.js'
import { ExtensionOut, extendTransformer, Transformer, TransformerOptions } from './transformer.js'
import { BlockCursor, Ctx } from './types.js'

export type BatchCtx = {
  head: {
    finalized?: BlockCursor
    unfinalized?: BlockCursor
  }
  state: {
    initial: number
    last: number
    current: BlockCursor
    /**
     * List of block cursors representing unfinalized blocks in chronological order.
     * Used for handling blockchain forks by tracking alternative chain versions
     * and enabling rollback to a valid chain state when a fork is detected.
     */
    rollbackChain: BlockCursor[]

    progress?: ProgressState
  }
  meta: {
    bytesSize: number
    lastBlockReceivedAt: Date
  }
  query: { hash: string; raw: any }
  profiler: Profiler
  metrics: Metrics
  logger: Logger
}

export type PortalBatch<T = any> = { data: T; ctx: BatchCtx }

export function cursorFromHeader(block: { header: { number: number; hash: string; timestamp?: number } }): BlockCursor {
  return { number: block.header.number, hash: block.header.hash, timestamp: block.header.timestamp }
}

export type PortalSourceOptions<Query> = {
  portal: string | PortalClientOptions | PortalClient
  query: Query
  logger: Logger
  profiler?: boolean
  cache?: PortalCacheOptions
  transformers?: Transformer<any, any>[]
  metricServer?: MetricsServer
  progress?: {
    interval?: number
    onStart?: (data: StartState) => void
    onProgress?: (progress: ProgressState) => void
  }
}

export class PortalSource<Q extends QueryBuilder, T = any> {
  readonly #options: {
    profiler: boolean
    cache?: PortalCacheOptions
  }
  readonly #queryBuilder: Q
  readonly #logger: Logger
  readonly #portal: PortalClient
  readonly #metricServer: MetricsServer
  readonly #transformers: Transformer<any, any>[]

  #started = false

  constructor({ portal, query, logger, progress, ...options }: PortalSourceOptions<Q>) {
    this.#portal =
      portal instanceof PortalClient
        ? portal
        : new PortalClient(
            typeof portal === 'string'
              ? { url: portal, http: { retryAttempts: Number.MAX_SAFE_INTEGER } }
              : { ...portal, http: { retryAttempts: Number.MAX_SAFE_INTEGER, ...portal.http } },
          )

    this.#queryBuilder = query
    this.#logger = logger
    this.#options = {
      cache: options.cache,
      profiler: typeof options.profiler === 'undefined' ? process.env.NODE_ENV !== 'production' : options.profiler,
    }
    this.#metricServer = options.metricServer || createMetricsServer()
    this.#transformers = options.transformers || []
  }

  async *read(cursor?: BlockCursor): AsyncIterable<PortalBatch<T>> {
    /*
     Calculates query ranges while excluding blocks that were previously fetched to avoid duplicate processing
     */
    const ranges = await this.#queryBuilder.calculateRanges({
      portal: this.#portal,
      bound: cursor ? { from: cursor.number + 1 } : undefined,
    })

    const initial = ranges[0]?.range.from || 0

    this.#logger.debug(`${ranges.length} range(s) configured`)

    await this.start({ initial, current: cursor })

    for (const { range, request } of ranges) {
      const query = {
        ...request,
        type: this.#queryBuilder.getType(),
        fields: this.#queryBuilder.getFields(),
        fromBlock: range.from,
        toBlock: range.to,
        parentBlockHash: cursor?.hash ? cursor.hash : undefined,
      }

      const source = this.#options.cache
        ? await createPortalCache({
            ...this.#options.cache,
            portal: this.#portal,
            logger: this.#logger,
            query,
          })
        : this.#portal.getStream(query)

      let batchSpan = Span.root('batch', this.#options.profiler)
      let readSpan = batchSpan.start('fetch data')
      for await (const batch of source) {
        readSpan.end()

        if (batch.blocks.length > 0) {
          // TODO WTF with any?
          const lastBatchBlock: { header: { number: number } } = last(batch.blocks as any)
          const finalized = batch.finalizedHead?.number

          const lastBlockNumber = Math.max(
            Math.min(last(ranges)?.range?.to || finalized || Infinity),
            lastBatchBlock?.header?.number || -Infinity,
          )

          const ctx: BatchCtx = {
            // Batch metadata
            meta: {
              bytesSize: batch.meta.bytes,
              lastBlockReceivedAt: batch.lastBlockReceivedAt,
            },
            head: {
              finalized: batch.finalizedHead,
              // TODO expose from portal
              unfinalized: undefined,
            },
            query: { hash: hashQuery(query), raw: query },

            // State of the stream at the moment of this batch processing
            state: {
              initial: initial,
              current: cursorFromHeader(lastBatchBlock as any),
              last: lastBlockNumber,
              rollbackChain: finalized
                ? batch.blocks.filter((b) => b.header.number >= finalized).map(cursorFromHeader)
                : [],
            },

            // Context for transformers
            profiler: batchSpan,
            metrics: this.#metricServer.metrics,
            logger: this.#logger,
          }

          const data = await this.applyTransformers(ctx, { blocks: batch.blocks } as T)

          yield { data, ctx }
        }

        batchSpan = Span.root('batch', this.#options.profiler)
        readSpan = batchSpan.start('fetch data')
      }
    }

    await this.stop()
  }

  pipe<Out>(transformer: TransformerOptions<T, Out, Q> | Transformer<T, Out, Q>): PortalSource<Q, Out> {
    if (this.#started) throw new Error('Source closed')

    return new PortalSource<Q, Out>({
      portal: this.#portal,
      query: this.#queryBuilder,
      logger: this.#logger,
      profiler: this.#options.profiler,
      cache: this.#options.cache,
      metricServer: this.#metricServer,
      transformers: [
        ...this.#transformers,
        transformer instanceof Transformer ? transformer : new Transformer(transformer),
      ],
    })
  }

  extend<Arg extends Record<string, Transformer<any, any>>>(extend: Arg): PortalSource<Q, ExtensionOut<T, Arg>> {
    return this.pipe(extendTransformer(extend))
  }

  async applyTransformers(ctx: BatchCtx, data: T) {
    const span = ctx.profiler.start('apply transformers')

    for (const transformer of this.#transformers) {
      data = await transformer.transform(data, {
        ...ctx,
        profiler: span,
        logger: this.#logger,
      })
    }
    span.end()

    return data
  }

  context<T extends Record<string, any>>(span: Profiler, rest?: T) {
    return {
      logger: this.#logger,
      profiler: span,
      ...rest,
    } as Ctx & T
  }

  async forkTransformers(profiler: Profiler, cursor: BlockCursor) {
    const span = profiler.start('transformers_rollback')
    const ctx = this.context(span)
    await Promise.all(this.#transformers.map((t) => t.fork(cursor, ctx)))
    span.end()
  }

  async configure() {
    const profiler = Span.root('configure', this.#options.profiler)

    const span = profiler.start('transformers')
    const ctx = this.context(span, {
      queryBuilder: this.#queryBuilder,
      portal: this.#portal,
      logger: this.#logger,
    })
    await Promise.all(this.#transformers.map((t) => t.query(ctx)))
    span.end()

    profiler.end()
  }

  async start(state: { initial: number; current?: BlockCursor }) {
    if (this.#started) {
      this.#logger.debug(`stream has been already started, skipping "start" hook...`)
      return
    }

    this.#logger.debug(`invoking <start> hook...`)

    const profiler = Span.root('start', this.#options.profiler)

    const span = profiler.start('transformers')
    const ctx = this.context(span, {
      metrics: this.#metricServer.metrics,
      state,
    })
    await Promise.all(this.#transformers.map((t) => t.start(ctx)))
    span.end()

    this.#metricServer.start()

    profiler.end()

    this.#logger.debug(`<start> hook invoked`)

    this.#started = true
  }

  async stop() {
    this.#started = false

    const profiler = Span.root('stop', this.#options.profiler)

    const span = profiler.start('transformers')
    const ctx = this.context(span)
    await Promise.all(this.#transformers.map((t) => t.stop(ctx)))
    span.end()

    profiler.end()

    await this.#metricServer.stop()
  }

  pipeTo(target: Target<T>) {
    const self = this

    return target.write({
      ctx: this.context(Span.root('write', this.#options.profiler)),
      read: async function* (cursor?: BlockCursor) {
        await self.configure()

        while (true) {
          try {
            for await (const batch of self.read(cursor)) {
              yield batch as PortalBatch<T>
              self.batchEnd(batch.ctx)
            }
            return
          } catch (e) {
            if (!isForkException(e)) throw e

            if (!e.previousBlocks.length) {
              // TODO how to explain this error? what to do next?
              throw new Error('Previous blocks are empty, but fork is detected')
            }

            if (!target.fork) {
              // TODO add docs about fork and how to implement it
              throw new Error('Target does not support fork')
            }

            const forkProfiler = Span.root('fork', self.#options.profiler)

            const span = forkProfiler.start('target_rollback')
            const forkedCursor = await target.fork(e.previousBlocks)
            span.end()

            if (!forkedCursor) {
              // TODO how to explain this error? what to do next?
              throw Error(`Fork detected, but target did not return a new cursor`)
            }

            await self.forkTransformers(forkProfiler, forkedCursor)

            cursor = forkedCursor
          } finally {
            await self.stop()
          }
        }
      },
    })
  }

  batchEnd(ctx: BatchCtx) {
    ctx.profiler.end()
    this.#metricServer.addBatchContext(ctx)
  }

  async *[Symbol.asyncIterator](): AsyncIterator<PortalBatch<T>> {
    await this.configure()

    try {
      for await (const batch of this.read()) {
        yield batch
        this.batchEnd(batch.ctx)
      }
    } catch (e) {
      throw e
    } finally {
      await this.stop()
    }
  }
}
