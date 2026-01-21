import { cast } from '@subsquid/util-internal-validation'

import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'

import {
  LogLevel,
  Logger,
  PortalCache,
  PortalRange,
  PortalSource,
  createDefaultLogger,
  createTransformer,
} from '../core/index.js'
import { PortalClientOptions, getBlockSchema, hyperliquidFills } from '../portal-client/index.js'
import { HyperliquidFillsQueryBuilder } from './hyperliquid-fills-query-builder.js'

export type HyperliquidFillsPortalData<F extends hyperliquidFills.FieldSelection> = {
  blocks: hyperliquidFills.Block<F>[]
}

export function hyperliquidFillsPortalSource<F extends hyperliquidFills.FieldSelection = any>({
  portal,
  query,
  cache,
  logger,
  metrics,
  progress,
}: {
  portal: string | PortalClientOptions
  query?: PortalRange | HyperliquidFillsQueryBuilder<F>
  cache?: PortalCache
  metrics?: MetricsServer
  logger?: Logger | LogLevel
  progress?: ProgressTrackerOptions
}) {
  logger = logger && typeof logger !== 'string' ? logger : createDefaultLogger({ level: logger })

  //FIXME STREAMS
  return new PortalSource<HyperliquidFillsQueryBuilder<F>, HyperliquidFillsPortalData<F>>({
    portal,
    query: !query
      ? new HyperliquidFillsQueryBuilder<F>()
      : query instanceof HyperliquidFillsQueryBuilder
        ? query
        : new HyperliquidFillsQueryBuilder<F>(),
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
      createTransformer<HyperliquidFillsPortalData<F>, HyperliquidFillsPortalData<F>>({
        profiler: { id: 'normalize data' },
        transform: (data, ctx) => {
          const schema = getBlockSchema<hyperliquidFills.Block<F>>(ctx.query.raw)

          data.blocks = data.blocks.map((b) => cast(schema, b))

          return data
        },
      }),
    ],
  })
}
