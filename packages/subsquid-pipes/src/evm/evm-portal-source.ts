import { Logger, PortalRange, PortalSource, parsePortalRange, Transformer } from '~/core/index.js'
import { ProgressTrackerOptions } from '~/core/progress-tracker.js'
import { PortalCacheOptions } from '~/portal-cache/portal-cache.js'
import { evm, PortalClient, PortalClientOptions } from '../portal-client/index.js'
import { EvmQueryBuilder } from './evm-query-builder.js'

export type EvmTransformer<In, Out> = Transformer<In, Out, EvmQueryBuilder>

export type EvmPortalData<F extends evm.FieldSelection> = { blocks: evm.Block<F>[] }

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
  progress?: ProgressTrackerOptions | false
}) {
  if (query && !(query instanceof EvmQueryBuilder)) {
    query = new EvmQueryBuilder().addRange(parsePortalRange(query))
  }

  return new PortalSource<EvmQueryBuilder, { blocks: any[] }>({
    portal,
    query: query || new EvmQueryBuilder(),
    cache,
    logger,
    progress,
  }).pipe({
    profiler: { id: 'normalize_data' },
    transform: (data) => {
      data.blocks =
        data.blocks.map((block) => ({
          ...block,
          logs: block.logs || [],
          transactions: block.transactions || [],
          stateDiffs: block.stateDiffs || [],
          traces: block.traces || [],
        })) || []

      return data
    },
  })
}
