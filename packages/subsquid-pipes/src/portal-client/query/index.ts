import { unexpectedCase } from '@subsquid/util-internal'
import { Validator } from '@subsquid/util-internal-validation'

import { Simplify } from './common.js'
import * as evm from './evm.js'
import * as hyperliquidFills from './hyperliquid-fills.js'
import * as solana from './solana.js'
import * as substrate from './substrate.js'

export type { PortalBlock, PortalQuery } from './common.js'

export type { evm, hyperliquidFills, solana, substrate }

export type Query = evm.Query | hyperliquidFills.Query | solana.Query | substrate.Query

export type GetBlock<Q extends Query> = Q extends evm.Query
  ? evm.Block<Q['fields']>
  : Q extends solana.Query
    ? solana.Block<Q['fields']>
    : Q extends substrate.Query
      ? substrate.Block<Q['fields']>
      : hyperliquidFills.Block<Q['fields']>

export function createQuery<Q extends Query>(query: Q): Simplify<Q & Query> {
  return {
    ...query,
    type: query.type,
    fields: query.fields,
  }
}

const BLOCK_SCHEMAS = new WeakMap<Query, Validator<any, any>>()

export function getBlockSchema<Block>(query: Query): Validator<Block, any> {
  let schema = BLOCK_SCHEMAS.get(query)
  if (schema) return schema

  switch (query.type) {
    case 'solana':
      schema = solana.getBlockSchema(query.fields)
      break
    case 'evm':
      schema = evm.getBlockSchema(query.fields)
      break
    case 'hyperliquidFills':
      schema = hyperliquidFills.getBlockSchema(query.fields)
      break
    case 'substrate':
      schema = substrate.getBlockSchema(query.fields)
      break
    default:
      throw unexpectedCase(query['type'])
  }

  BLOCK_SCHEMAS.set(query, schema)

  return schema
}
