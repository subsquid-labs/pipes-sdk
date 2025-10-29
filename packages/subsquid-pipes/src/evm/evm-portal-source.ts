import {
  createDefaultLogger,
  createTransformer,
  Logger,
  PortalRange,
  PortalSource,
  parsePortalRange,
  Transformer,
} from '~/core/index.js'
import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'
import { PortalCacheOptions } from '~/portal-cache/portal-cache.js'
import { evm, PortalClient, PortalClientOptions } from '../portal-client/index.js'
import { EvmQueryBuilder } from './evm-query-builder.js'

export type EvmTransformer<In, Out> = Transformer<In, Out, EvmQueryBuilder>

export type EvmPortalData<F extends evm.FieldSelection> = { blocks: evm.Block<F>[] }

export function createEvmPortalSource<F extends evm.FieldSelection = any>({
  portal,
  query,
  cache,
  logger,
  metrics,
  progress,
}: {
  portal: string | PortalClientOptions | PortalClient
  query?: PortalRange | EvmQueryBuilder<F>
  cache?: PortalCacheOptions
  metrics?: MetricsServer
  logger?: Logger
  progress?: ProgressTrackerOptions
}) {
  logger = logger || createDefaultLogger()

  return new PortalSource<EvmQueryBuilder<F>, EvmPortalData<F>>({
    portal,
    query: !query
      ? new EvmQueryBuilder<F>()
      : query instanceof EvmQueryBuilder
        ? query
        : new EvmQueryBuilder<F>().addRange(parsePortalRange(query)),
    cache,
    logger,
    metrics,
    transformers: [
      progressTracker({
        logger: logger,
        interval: progress?.interval,
        onStart: progress?.onStart,
        onProgress: progress?.onProgress,
      }),
      createTransformer<EvmPortalData<F>, EvmPortalData<F>>({
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
