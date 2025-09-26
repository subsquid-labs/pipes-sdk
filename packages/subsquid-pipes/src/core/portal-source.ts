import { isForkException, PortalClient, PortalClientOptions } from '~/portal-client/index.js'
import { last } from '../internal/array.js'
import { createPortalCache, PortalCacheOptions } from '../portal-cache/portal-cache.js'
import { createDefaultLogger, Logger } from './logger.js'
import { Profiler, Span } from './profiling.js'
import { ProgressState, progressTracker, StartState } from './progress-tracker.js'
import { createPrometheusMetrics, Metrics } from './prometheus-metrics.js'
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
  }
  bytes: number
  lastBlockReceivedAt: Date
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
  logger?: Logger
  profiler?: boolean
  cache?: PortalCacheOptions
  progress?:
    | {
        interval?: number
        onStart?: (data: StartState) => void
        onProgress?: (progress: ProgressState) => void
      }
    | false
    | null
}

export class PortalSource<Q extends QueryBuilder, T = any> {
  readonly #options: {
    profiler: boolean
    cache?: PortalCacheOptions
  }
  readonly #queryBuilder: Q
  readonly #logger: Logger
  readonly #portal: PortalClient
  readonly #metrics: Metrics

  #started = false
  #transformers: Transformer<any, any>[] = []

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
    this.#logger = logger || createDefaultLogger()
    this.#options = {
      ...options,
      profiler: typeof options.profiler === 'undefined' ? process.env.NODE_ENV !== 'production' : options.profiler,
    }
    this.#metrics = createPrometheusMetrics()

    if (progress !== false && progress !== null) {
      this.#transformers.push(
        progressTracker({
          logger: this.#logger,
          interval: 5000,
          ...progress,
        }),
      )
    }
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
      for await (const rawBatch of source) {
        readSpan.end()

        if (rawBatch.blocks.length > 0) {
          // TODO WTF with any?
          const lastBatchBlock: { header: { number: number } } = last(rawBatch.blocks as any)
          const finalized = rawBatch.finalizedHead?.number

          const lastBlockNumber = Math.max(
            Math.min(last(ranges)?.range?.to || finalized || Infinity),
            lastBatchBlock?.header?.number || -Infinity,
          )

          const ctx: BatchCtx = {
            // Batch metadata
            bytes: rawBatch.meta.bytes,
            lastBlockReceivedAt: rawBatch.lastBlockReceivedAt,
            head: {
              finalized: rawBatch.finalizedHead,
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
                ? rawBatch.blocks.filter((b) => b.header.number >= finalized).map(cursorFromHeader)
                : [],
            },

            // Context for transformers
            profiler: batchSpan,
            metrics: this.#metrics,
            logger: this.#logger,
          }

          const data = await this.applyTransformers(ctx, { blocks: rawBatch.blocks } as T)

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

    this.#transformers.push(transformer instanceof Transformer ? transformer : new Transformer(transformer))

    return this as unknown as PortalSource<Q, Out>
  }

  extend<Arg extends Record<string, Transformer<any, any>>>(extend: Arg): PortalSource<Q, ExtensionOut<T, Arg>> {
    return this.pipe(extendTransformer(extend))
  }

  async applyTransformers(ctx: BatchCtx, data: T) {
    const span = ctx.profiler.start('transformers')

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
      metrics: this.#metrics,
      state,
    })
    await Promise.all(this.#transformers.map((t) => t.start(ctx)))
    span.end()

    this.#metrics.start()

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

    await this.#metrics.stop()

    profiler.end()
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

              batch.ctx.profiler.end()
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
              throw Error(`Fork has been detected, but pipeline couldn't find the cursor to continue from`)
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

  async *[Symbol.asyncIterator](): AsyncIterator<PortalBatch<T>> {
    await this.configure()

    try {
      for await (const batch of this.read()) {
        batch.ctx.profiler.end()
        yield batch
      }
    } catch (e) {
      throw e
    } finally {
      await this.stop()
    }
  }
}
