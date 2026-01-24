import { useRuntimeContext } from '$context'

import { Decoder } from '~/core/decoder.js'
import {
  GetBlock,
  PortalClient,
  PortalClientOptions,
  PortalStream,
  Query,
  isForkException,
} from '~/portal-client/index.js'

import { last } from '../internal/array.js'
import { Logger, formatWarning } from './logger.js'
import { Metrics, MetricsServer, noopMetricsServer } from './metrics-server.js'
import { Profiler, Span } from './profiling.js'
import { ProgressState, StartState } from './progress-tracker.js'
import { QueryBuilder, hashQuery } from './query-builder.js'
import { Target } from './target.js'
import { Transformer, TransformerOptions } from './transformer.js'
import { BlockCursor, Ctx } from './types.js'

const NOT_REAL_TIME_WARNING = (name: string) => {
  return formatWarning({
    title: `This dataset (${name}) does not provide real-time (head) block streaming`,
    content: [
      'Portal data for this dataset will lag behind the chain head.',
      'This is expected. Do not rely on this dataset for latency-critical workflows.',
    ],
  })
}

export interface PortalCache {
  getStream<Q extends Query>(options: { portal: PortalClient; query: Q; logger: Logger }): PortalStream<GetBlock<Q>>
}

export type BatchCtx = {
  head: {
    finalized?: BlockCursor
    latest?: BlockCursor
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
    /**
     * Current progress state of batch processing. Contains information about
     * the completion percentage, processed blocks count, and other metrics
     * that help track the indexing progress.
     */
    progress?: ProgressState
  }
  meta: {
    bytesSize: number
    requests: Record<number, number>
    lastBlockReceivedAt: Date
  }
  query: { url: string; hash: string; raw: any }
  profiler: Profiler
  metrics: Metrics
  logger: Logger
}

export type PortalBatch<T = any> = { data: T; ctx: BatchCtx }

export function cursorFromHeader(block: { header: { number: number; hash: string; timestamp?: number } }): BlockCursor {
  return { number: block.header.number, hash: block.header.hash, timestamp: block.header.timestamp }
}

type AnyTransformer = Decoder<any, any, any> | Transformer<any, any>

export type PortalSourceOptions<Query> = {
  portal: string | PortalClientOptions | PortalClient
  query: Query
  logger: Logger
  profiler?: boolean
  cache?: PortalCache
  transformers?: AnyTransformer[]
  metrics?: MetricsServer
  progress?: {
    interval?: number
    onStart?: (data: StartState) => void
    onProgress?: (progress: ProgressState) => void
  }
}

export class PortalSource<Q extends QueryBuilder<any>, T = any> {
  readonly #options: {
    profiler: boolean
    cache?: PortalCache
  }
  readonly #queryBuilder: Q
  readonly #logger: Logger
  readonly #portal: PortalClient
  readonly #metricServer: MetricsServer
  readonly #transformers: AnyTransformer[]
  #started = false

  constructor({ portal, query, logger, progress, ...options }: PortalSourceOptions<Q>) {
    const ctx = useRuntimeContext()

    this.#portal =
      portal instanceof PortalClient
        ? portal
        : new PortalClient(
            typeof portal === 'string'
              ? {
                  url: portal,
                  http: {
                    logger,
                    retryAttempts: Number.MAX_SAFE_INTEGER,
                  },
                }
              : {
                  ...portal,
                  http: {
                    logger,
                    retryAttempts: Number.MAX_SAFE_INTEGER,
                    ...portal.http,
                  },
                },
          )

    this.#queryBuilder = query
    this.#logger = logger
    this.#options = {
      cache: options.cache,
      profiler: typeof options.profiler === 'undefined' ? process.env.NODE_ENV !== 'production' : options.profiler,
    }

    this.#metricServer = options.metrics ?? ctx?.metrics ?? noopMetricsServer()
    this.#transformers = options.transformers || []
  }

  private async *read(cursor?: BlockCursor): AsyncIterable<PortalBatch<T>> {
    /*
     Calculates query ranges while excluding blocks that were previously fetched to avoid duplicate processing
     */
    const { bounded, raw } = await this.#queryBuilder.calculateRanges({
      portal: this.#portal,
      bound: cursor ? { from: cursor.number + 1 } : undefined,
    })

    const initial = raw[0]?.range.from || 0

    this.#logger.debug(`${bounded.length} range(s) configured`)

    await this.start({ initial, current: cursor })

    const metadata = await this.#portal.getMetadata()
    if (!metadata.real_time) {
      this.#logger.warn(NOT_REAL_TIME_WARNING(metadata.dataset))
    }

    for (const { range, request } of bounded) {
      const query = {
        ...request,
        type: this.#queryBuilder.getType(),
        fields: this.#queryBuilder.getFields(),
        fromBlock: range.from,
        toBlock: range.to,
        parentBlockHash: cursor?.hash ? cursor.hash : undefined,
      }

      const source = this.#options.cache
        ? // use cache if available
          this.#options.cache.getStream({
            portal: this.#portal,
            logger: this.#logger,
            query,
          })
        : this.#portal.getStream(query)

      let batchSpan = Span.root('batch', this.#options.profiler)
      let readSpan = batchSpan.start('fetch data')
      for await (const batch of source) {
        readSpan.end()

        const blocks = batch.blocks

        if (blocks.length > 0) {
          // TODO WTF with any?
          const lastBatchBlock = last(blocks as { header: { number: number } }[])
          const finalizedHead = batch.head.finalized?.number

          const lastBlockNumber = Math.max(
            Math.min(last(bounded)?.range?.to || batch.head.latest?.number || batch.head.finalized?.number || Infinity),
            lastBatchBlock.header?.number || -Infinity,
          )

          const ctx: BatchCtx = {
            // Batch metadata
            meta: {
              bytesSize: batch.meta.bytes,
              requests: batch.meta.requests,
              lastBlockReceivedAt: batch.meta.lastBlockReceivedAt,
            },
            head: {
              finalized: batch.head.finalized,
              latest: batch.head.latest,
            },
            query: {
              url: this.#portal.getUrl(),
              hash: await hashQuery(query),
              raw: query,
            },

            // State of the stream at the moment of this batch processing
            state: {
              initial,
              current: cursorFromHeader(lastBatchBlock as any),
              last: lastBlockNumber,
              rollbackChain: finalizedHead
                ? batch.blocks.filter((b) => b.header.number >= finalizedHead).map(cursorFromHeader)
                : [],
            },

            // Context for transformers
            profiler: batchSpan,
            metrics: this.#metricServer.metrics(),
            logger: this.#logger,
          }

          const data = await this.applyTransformers(ctx, batch.blocks as T)

          yield { data, ctx }
        }

        batchSpan = Span.root('batch', this.#options.profiler)
        readSpan = batchSpan.start('fetch data')
      }
    }

    await this.stop()
  }

  pipe<Out>(
    transformerOrOptions: /*
        Simplified usage - just the transform function that processes data
        .pipe((data) => data)
      */
      | TransformerOptions<T, Out>['transform']
      /*
        Complete transformer configuration object with transform function and additional options
        .pipe({ profiler: { id: 'my transformer' }, transform: (data) => data })
       */
      | TransformerOptions<T, Out>
      /*
        Pre-configured transformer instance with all required methods implemented
        .pipe(new MyCustomTransformer())
       */
      | Transformer<T, Out>,
  ): PortalSource<Q, Out> {
    if (this.#started) throw new Error('Source is closed')

    const transformer =
      transformerOrOptions instanceof Transformer
        ? transformerOrOptions
        : typeof transformerOrOptions === 'function'
          ? new Transformer({ transform: transformerOrOptions })
          : new Transformer(transformerOrOptions)

    const id = transformer.id()

    // If there are multiple transformers with the same ID, we append a numeric suffix to make them unique
    // This is important for profiling and logging to avoid confusion between transformers
    // when analyzing performance or debugging issues
    const exists = this.#transformers.filter((t) => t.id() === id)
    if (exists.length) {
      transformer.setId(`${id} ${exists.length + 1}`)
    }

    return new PortalSource<Q, Out>({
      portal: this.#portal,
      query: this.#queryBuilder,
      logger: this.#logger,
      profiler: this.#options.profiler,
      cache: this.#options.cache,
      metrics: this.#metricServer,
      transformers: [...this.#transformers, transformer],
    })
  }

  private async applyTransformers(ctx: BatchCtx, data: T) {
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

  private context<T extends Record<string, any>>(span: Profiler, rest?: T) {
    return {
      logger: this.#logger,
      profiler: span,
      ...rest,
    } as Ctx & T
  }

  private async forkTransformers(profiler: Profiler, cursor: BlockCursor) {
    const span = profiler.start('transformers_rollback')
    const ctx = this.context(span)
    await Promise.all(this.#transformers.map((t) => t.fork(cursor, ctx)))
    span.end()
  }

  private async configure() {
    await Promise.all(
      this.#transformers
        .filter((t) => t instanceof Decoder)
        .map((t) =>
          t.query({
            queryBuilder: this.#queryBuilder,
            portal: this.#portal,
            logger: this.#logger,
          }),
        ),
    )
  }

  private async start(state: { initial: number; current?: BlockCursor }) {
    if (this.#started) {
      this.#logger.debug(`stream has been already started, skipping "start" hook...`)
      return
    }

    this.#logger.debug(`invoking <start> hook...`)

    const profiler = Span.root('start', this.#options.profiler)

    const span = profiler.start('transformers')
    const ctx = this.context(span, {
      metrics: this.#metricServer.metrics(),
      state,
    })
    await Promise.all(this.#transformers.map((t) => t.start(ctx)))
    span.end()

    this.#metricServer.start()

    profiler.end()

    this.#logger.debug(`<start> hook invoked`)
    this.#started = true
  }

  /** @internal */
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
      logger: this.#logger,
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

  private batchEnd(ctx: BatchCtx) {
    ctx.profiler.end()
    this.#metricServer.batchProcessed(ctx)
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
