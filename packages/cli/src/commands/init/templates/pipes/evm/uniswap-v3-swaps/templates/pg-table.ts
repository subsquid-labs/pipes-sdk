import { bigint, integer, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core'

export const uniswapV3SwapsTable = pgTable(
  'uniswap_v3_swaps',
  {
    blockNumber: integer().notNull(),
    txHash: varchar({ length: 66 }).notNull(),
    logIndex: integer().notNull(),
    timestamp: bigint({ mode: 'number' }).notNull(),
    pool: varchar({ length: 42 }).notNull(),
    token0: varchar({ length: 42 }).notNull(),
    token1: varchar({ length: 42 }).notNull(),
    tick: integer().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.blockNumber, table.txHash, table.logIndex],
    }),
  ],
)
