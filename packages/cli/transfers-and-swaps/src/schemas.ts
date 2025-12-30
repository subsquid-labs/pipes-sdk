import {
  integer,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

export const transfersTable = pgTable(
  'transfers',
  {
    blockNumber: integer().notNull(),
    timestamp: timestamp(),
    from: varchar().notNull(),
    to: varchar().notNull(),
    value: numeric({ mode: 'bigint' }).notNull(),
    tokenAddress: varchar().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.blockNumber, table.from, table.to, table.tokenAddress],
    }),
  ],
)

import {
  integer,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

export const uniswapV3Swaps = pgTable(
  'uniswap_v3_swaps',
  {
    blockNumber: integer().notNull(),
    txHash: varchar({ length: 66 }).notNull(),
    logIndex: integer().notNull(),
    timestamp: timestamp().notNull(),
    poolAddress: varchar({ length: 42 }).notNull(),
    token0: varchar({ length: 42 }).notNull(),
    token1: varchar({ length: 42 }).notNull(),
    fee: numeric({ mode: 'bigint' }).notNull(),
    tickSpacing: numeric({ mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.blockNumber, table.txHash, table.logIndex],
    }),
  ],
)

export default {
  transfersTable,
  uniswapV3Swaps,
}
