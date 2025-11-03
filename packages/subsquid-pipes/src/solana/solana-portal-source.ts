import { cast } from '@subsquid/util-internal-validation'
import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'
import {
  createDefaultLogger,
  createTransformer,
  Logger,
  PortalCacheAdapter,
  PortalRange,
  PortalSource,
  Transformer,
} from '../core/index.js'
import { createPortalClient, getBlockSchema, PortalClientOptions, solana } from '../portal-client/index.js'
import { SolanaQueryBuilder } from './solana-query-builder.js'

export type SolanaTransformer<In, Out> = Transformer<In, Out, SolanaQueryBuilder>

export type SolanaPortalData<F extends solana.FieldSelection> = { blocks: solana.Block<F>[] }

export function createSolanaPortalSource<F extends solana.FieldSelection = any>({
  portal,
  query,
  cache,
  logger,
  metrics,
  progress,
}: {
  portal: string | PortalClientOptions
  query?: PortalRange | SolanaQueryBuilder<F>
  cache?: PortalCacheAdapter
  metrics?: MetricsServer
  logger?: Logger
  progress?: ProgressTrackerOptions
}) {
  logger = logger || createDefaultLogger()

  return new PortalSource<SolanaQueryBuilder<F>, SolanaPortalData<F>>({
    portal: cache ? cache.init(createPortalClient(portal)) : createPortalClient(portal),
    query: !query
      ? new SolanaQueryBuilder<F>()
      : query instanceof SolanaQueryBuilder
        ? query
        : new SolanaQueryBuilder<F>().addRange(query),
    logger,
    metrics,
    transformers: [
      progressTracker({
        logger: logger,
        interval: progress?.interval,
        onStart: progress?.onStart,
        onProgress: progress?.onProgress,
      }),
      createTransformer<SolanaPortalData<F>, SolanaPortalData<F>>({
        profiler: { id: 'normalize data' },
        transform: (data, ctx) => {
          const schema = getBlockSchema<solana.Block<F>>(ctx.query.raw)

          data.blocks = data.blocks.map((b) => cast(schema, b))

          return data
        },
      }),
    ],
  })
}
