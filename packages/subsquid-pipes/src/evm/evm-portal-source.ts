import {
  createDefaultLogger,
  createTransformer,
  Logger,
  PortalRange,
  PortalSource,
  parsePortalRange,
  Transformer,
} from '~/core/index.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'
import { PortalCacheOptions } from '~/portal-cache/portal-cache.js'
import { evm, PortalClient, PortalClientOptions } from '../portal-client/index.js'
import { EvmQueryBuilder } from './evm-query-builder.js'

export type EvmTransformer<In, Out> = Transformer<In, Out, EvmQueryBuilder>

export type EvmPortalData<F extends evm.FieldSelection> = { blocks: evm.Block<F>[] }

type DefaultData = { blocks: any[] }

export function createEvmPortalSource({
  portal,
  query,
  cache,
  logger,
  progress,
}: {
  portal: string | PortalClientOptions | PortalClient
  query?: PortalRange | EvmQueryBuilder
  cache?: PortalCacheOptions
  logger?: Logger
  progress?: ProgressTrackerOptions
}) {
  if (query && !(query instanceof EvmQueryBuilder)) {
    query = new EvmQueryBuilder().addRange(parsePortalRange(query))
  }

  logger = logger || createDefaultLogger()

  return new PortalSource<EvmQueryBuilder, DefaultData>({
    portal,
    query: query || new EvmQueryBuilder(),
    cache,
    logger,
    transformers: [
      progressTracker({
        logger: logger,
        interval: progress?.interval,
        onStart: progress?.onStart,
        onProgress: progress?.onProgress,
      }),
      createTransformer<DefaultData, DefaultData>({
        profiler: { id: 'normalize data' },
        transform: (data) => {
          data.blocks = data.blocks.map((block) => ({
            ...block,
            logs: block.logs || [],
            transactions: block.transactions || [],
            stateDiffs: block.stateDiffs || [],
            traces: block.traces || [],
          }))

          return data
        },
      }),
    ],
  })
}
