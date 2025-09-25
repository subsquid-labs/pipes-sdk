import { Logger, Transformer } from '../core'
import { PortalSource } from '../core/portal-source'
import { PortalCacheOptions } from '../portal-cache/portal-cache'
import { evm, PortalClientOptions, solana } from '../portal-client'
import { SolanaQueryBuilder } from './solana-query-builder'

export type SvmTransformer<In, Out> = Transformer<In, Out, SolanaQueryBuilder>

export type SvmPortalData<F extends evm.FieldSelection> = { blocks: solana.Block<F>[] }

export function createSvnPortalSource({
  portal,
  query,
  cache,
  logger,
}: {
  portal: string | PortalClientOptions
  query?: SolanaQueryBuilder
  cache?: PortalCacheOptions
  logger?: Logger
}) {
  return new PortalSource<SolanaQueryBuilder, { blocks: any[] }>({
    portal,
    query: query || new SolanaQueryBuilder(),
    cache,
    logger,
  })
}
