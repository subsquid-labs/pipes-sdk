import { Logger, PortalRange, parsePortalRange, Transformer } from '~/core'
import { PortalSource } from '../core/portal-source'
import { ProgressTrackerOptions } from '../core/progress-tracker'
import { PortalCacheOptions } from '../portal-cache/portal-cache'
import { evm, PortalClient, PortalClientOptions } from '../portal-client'
import { EvmQueryBuilder } from './evm-query-builder'

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
  })
}
