import { cast } from '@subsquid/util-internal-validation'

import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'

import {
  LogLevel,
  Logger,
  PortalCache,
  PortalRange,
  PortalSource,
  Transformer,
  createDefaultLogger,
  createTransformer,
} from '../core/index.js'
import { PortalClientOptions, getBlockSchema, substrate } from '../portal-client/index.js'
import { SubstrateQueryBuilder } from './substrate-query-builder.js'

export type SubstrateTransformer<In, Out> = Transformer<In, Out, SubstrateQueryBuilder>

export type SubstratePortalData<F extends substrate.FieldSelection> = { blocks: substrate.Block<F>[] }

export function substratePortalSource<F extends substrate.FieldSelection = any>({
  portal,
  query,
  cache,
  logger,
  metrics,
  progress,
}: {
  portal: string | PortalClientOptions
  query?: PortalRange | SubstrateQueryBuilder<F>
  cache?: PortalCache
  metrics?: MetricsServer
  logger?: Logger | LogLevel
  progress?: ProgressTrackerOptions
}) {
  logger = logger && typeof logger !== 'string' ? logger : createDefaultLogger({ level: logger })

  return new PortalSource<SubstrateQueryBuilder<F>, SubstratePortalData<F>>({
    portal,
    query: !query
      ? new SubstrateQueryBuilder<F>()
      : query instanceof SubstrateQueryBuilder
        ? query
        : new SubstrateQueryBuilder<F>().addRange(query),
    cache,
    logger,
    metrics,
    transformers: [
      progressTracker({
        logger,
        interval: progress?.interval,
        onStart: progress?.onStart,
        onProgress: progress?.onProgress,
      }),
      createTransformer<SubstratePortalData<F>, SubstratePortalData<F>>({
        profiler: { id: 'normalize data' },
        transform: (data, ctx) => {
          const schema = getBlockSchema<substrate.Block<F>>(ctx.query.raw)

          data.blocks = data.blocks.map((b) => cast(schema, b))

          return data
        },
      }),
    ],
  })
}

/**
 *  @deprecated use `substratePortalSource` instead
 */
export const createSubstratePortalSource = substratePortalSource
