import { Logger, PortalSource, Transformer } from '../core/index.js'
import { PortalCacheOptions } from '../portal-cache/portal-cache.js'
import { evm, PortalClientOptions, solana } from '../portal-client/index.js'
import { SolanaQueryBuilder } from './solana-query-builder.js'

export type SolanaTransformer<In, Out> = Transformer<In, Out, SolanaQueryBuilder>

export type SolanaPortalData<F extends evm.FieldSelection> = { blocks: solana.Block<F>[] }

export function createSolanaPortalSource({
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
