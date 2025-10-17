import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'
import {
  createDefaultLogger,
  createTransformer,
  Logger,
  MetricsServerOptions,
  PortalRange,
  PortalSource,
  parsePortalRange,
  Transformer,
} from '../core/index.js'
import { PortalCacheOptions } from '../portal-cache/portal-cache.js'
import { PortalClientOptions, solana } from '../portal-client/index.js'
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
  cache?: PortalCacheOptions
  metrics?: MetricsServerOptions
  logger?: Logger
  progress?: ProgressTrackerOptions
}) {
  logger = logger || createDefaultLogger()

  return new PortalSource<SolanaQueryBuilder<F>, SolanaPortalData<F>>({
    portal,
    query: !query
      ? new SolanaQueryBuilder<F>()
      : query instanceof SolanaQueryBuilder
        ? query
        : new SolanaQueryBuilder<F>().addRange(parsePortalRange(query)),
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
      createTransformer<SolanaPortalData<F>, SolanaPortalData<F>>({
        profiler: { id: 'normalize data' },
        transform: (data) => {
          data.blocks = data.blocks.map((block) => ({
            ...block,
            logs: block.logs || [],
            transactions: block.transactions || [],
            instructions: block.instructions || [],
            tokenBalances: block.tokenBalances || [],
            balances: block.balances || [],
            rewards: block.rewards || [],
          }))

          return data
        },
      }),
    ],
  })
}
