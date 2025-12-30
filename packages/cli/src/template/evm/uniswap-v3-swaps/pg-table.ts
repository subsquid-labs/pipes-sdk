import { pgTable, varchar, timestamp, numeric, integer, primaryKey } from "drizzle-orm/pg-core";

export const uniswapV3Swaps = pgTable("uniswap_v3_swaps", {
  blockNumber: integer().notNull(),
  txHash: varchar({ length: 66 }).notNull(),
  logIndex: integer().notNull(),
  timestamp: timestamp().notNull(),
  poolAddress: varchar({ length: 42 }).notNull(),
  token0: varchar({ length: 42 }).notNull(),
  token1: varchar({ length: 42 }).notNull(),
  fee: numeric({ mode: 'bigint' }).notNull(),
  tickSpacing: numeric({ mode: 'bigint' }).notNull(),
}, (table) => [
  primaryKey({
    columns: [table.blockNumber, table.txHash, table.logIndex],
  }),
]);