import { cast } from '@subsquid/util-internal-validation'
import {
  createDefaultLogger,
  createTransformer,
  Logger,
  PortalCacheAdapter,
  PortalRange,
  PortalSource,
  Transformer,
} from '~/core/index.js'
import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'
import { createPortalClient, evm, getBlockSchema, PortalClient, PortalClientOptions } from '../portal-client/index.js'
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
  cache?: PortalCacheAdapter
  metrics?: MetricsServer
  logger?: Logger
  progress?: ProgressTrackerOptions
}) {
  logger = logger || createDefaultLogger()

  return new PortalSource<EvmQueryBuilder<F>, EvmPortalData<F>>({
    portal: cache ? cache.init(createPortalClient(portal)) : createPortalClient(portal),
    query: !query
      ? new EvmQueryBuilder<F>()
      : query instanceof EvmQueryBuilder
        ? query
        : new EvmQueryBuilder<F>().addRange(query),
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
        transform: (data, ctx) => {
          const schema = getBlockSchema<evm.Block<F>>(ctx.query.raw)

          data.blocks = data.blocks.map((b) => cast(schema, b))

          return data
        },
      }),
    ],
  })
}
