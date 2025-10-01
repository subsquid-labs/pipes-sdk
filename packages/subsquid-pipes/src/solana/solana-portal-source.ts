import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'
import {
  createDefaultLogger,
  createTransformer,
  Logger,
  PortalRange,
  PortalSource,
  parsePortalRange,
  Transformer,
} from '../core/index.js'
import { PortalCacheOptions } from '../portal-cache/portal-cache.js'
import { evm, PortalClientOptions, solana } from '../portal-client/index.js'
import { SolanaQueryBuilder } from './solana-query-builder.js'

export type SolanaTransformer<In, Out> = Transformer<In, Out, SolanaQueryBuilder>

export type SolanaPortalData<F extends evm.FieldSelection> = { blocks: solana.Block<F>[] }

type DefaultData = { blocks: any[] }

export function createSolanaPortalSource({
  portal,
  query,
  cache,
  logger,
  progress,
}: {
  portal: string | PortalClientOptions
  query?: PortalRange | SolanaQueryBuilder
  cache?: PortalCacheOptions
  logger?: Logger
  progress?: ProgressTrackerOptions
}) {
  if (query && !(query instanceof SolanaQueryBuilder)) {
    query = new SolanaQueryBuilder().addRange(parsePortalRange(query))
  }

  logger = logger || createDefaultLogger()

  return new PortalSource<SolanaQueryBuilder, { blocks: any[] }>({
    portal,
    query: query || new SolanaQueryBuilder(),
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
