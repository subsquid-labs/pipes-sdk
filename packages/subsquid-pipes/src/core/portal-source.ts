import {
  ApiDataset,
  GetBlock,
  PortalClient,
  PortalClientOptions,
  PortalStream,
  Query,
  isForkException,
} from '~/portal-client/index.js'

import { last } from '../internal/array.js'
import {
  DefaultPipeIdError,
  ForkCursorMissingError,
  ForkNoPreviousBlocksError,
  TargetForkNotSupportedError,
} from './errors.js'
import { LogLevel, Logger, createDefaultLogger, formatWarning } from './logger.js'
import { Metrics, MetricsServer, noopMetricsServer } from './metrics-server.js'
import { Profiler, Span, SpanHooks } from './profiling.js'
import { ProgressEvent, StartEvent } from './progress-tracker.js'
import { QueryBuilder, hashQuery } from './query-builder.js'
import { Target } from './target.js'
import {
  QueryAwareTransformer,
  Transformer,
  TransformerArgs,
  TransformerFn,
  TransformerOptions,
} from './transformer.js'
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
  id: string
  dataset: ApiDataset
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
    progress?: ProgressEvent['progress']
  }
  meta: {
    blocksCount: number
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

type PartialBlock = { header: { number: number; hash: string; timestamp?: number } }

export function cursorFromHeader(block: PartialBlock): BlockCursor {
  return { number: block.header.number, hash: block.header.hash, timestamp: block.header.timestamp }
}

/** @internal */
export function extractRollbackChain({ blocks, head }: { blocks: PartialBlock[]; head?: BlockCursor }): BlockCursor[] {
  if (!head) return []
  if (!blocks.length) return []

  return blocks
    .filter((b) => {
      return b.header.number > head.number
    })
    .map(cursorFromHeader)
}

export type PortalSourceOptions<Query> = {
  /**
   * Globally unique, stable identifier for this pipe.
   * Targets use it as a cursor key to persist progress — two pipes with the
   * same `id` will share (and overwrite) each other's cursor.
   * Required when calling `.pipeTo()`.
   */
  id?: string
  portal: string | PortalClientOptions | PortalClient
  query: Query
  logger?: Logger | LogLevel
  profiler?: boolean | SpanHooks
  cache?: PortalCache
  transformers?: Transformer<any, any>[]
  metrics?: MetricsServer
  progress?: {
    interval?: number
    onStart?: (data: StartEvent) => void
    onProgress?: (progress: ProgressEvent) => void
  }
}

export const DEFAULT_PIPE_NAME = 'stream'

export class PortalSource<Q extends QueryBuilder<any>, T = any> {
  readonly #id: string
  readonly #options: {
    profiler: boolean | SpanHooks
    cache?: PortalCache
  }
  readonly #queryBuilder: Q
  readonly #logger: Logger
  readonly #portal: PortalClient
  readonly #metricServer: MetricsServer
  readonly #transformers: Transformer<any, any>[] = []
  #started = false

  constructor({ portal, id, query, logger, progress, ...options }: PortalSourceOptions<Q>) {
    this.#id = id || DEFAULT_PIPE_NAME
    this.#logger = logger && typeof logger !== 'string' ? logger : createDefaultLogger({ id: this.#id, level: logger })

    this.#portal =
      portal instanceof PortalClient
        ? portal
        : new PortalClient(
            typeof portal === 'string'
              ? {
                  url: portal,
                  http: {
                    logger: this.#logger,
                    retryAttempts: Number.MAX_SAFE_INTEGER,
                  },
                }
              : {
                  ...portal,
                  http: {
                    logger: this.#logger,
                    retryAttempts: Number.MAX_SAFE_INTEGER,
                    ...portal.http,
                  },
                },
          )

    this.#queryBuilder = query

    this.#options = {
      cache: options.cache,
      profiler: typeof options.profiler === 'undefined' ? process.env.NODE_ENV !== 'production' : options.profiler,
    }

    this.#metricServer = options.metrics ?? noopMetricsServer()
    this.#transformers = options.transformers || []

    this.#metricServer.registerPipe(this.#id)
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

    const datasetMetadata = await this.#portal.getMetadata()
    if (!datasetMetadata.real_time) {
      this.#logger.warn(NOT_REAL_TIME_WARNING(datasetMetadata.dataset))
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

          const lastBlockNumber = Math.max(
            Math.min(last(bounded)?.range?.to || batch.head.latest?.number || batch.head.finalized?.number || Infinity),
            lastBatchBlock.header?.number || -Infinity,
          )

          const ctx: BatchCtx = {
            // Batch metadata
            id: this.#id,
            dataset: datasetMetadata,
            meta: {
              blocksCount: batch.blocks.length,
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
              rollbackChain: extractRollbackChain({
                blocks: batch.blocks,
                head: batch.head.finalized,
              }),
            },

            // Context for transformers
            profiler: batchSpan,
            metrics: this.#metricServer.metrics,
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

  pipe<Out>(options: TransformerArgs<T, Out>): PortalSource<Q, Out> {
    if (this.#started) throw new Error('Source is closed')

    const transformer = options instanceof Transformer ? options : new Transformer(options)

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
      data = await transformer.run(data, {
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
        .filter((t) => t instanceof QueryAwareTransformer)
        .map((t) =>
          t.setupQuery({
            query: this.#queryBuilder,
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
      id: this.#id,
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
    if (this.#id === DEFAULT_PIPE_NAME) {
      throw new DefaultPipeIdError()
    }

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
              throw new ForkNoPreviousBlocksError()
            }

            if (!target.fork) {
              throw new TargetForkNotSupportedError()
            }

            const forkProfiler = Span.root('fork', self.#options.profiler)

            const span = forkProfiler.start('target_rollback')
            const forkedCursor = await target.fork(e.previousBlocks)
            span.end()

            if (!forkedCursor) {
              throw new ForkCursorMissingError()
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
