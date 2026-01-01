import { bigint, integer, numeric, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core'

export const tokenBalancesTable = pgTable(
  'token_balances',
  {
    blockNumber: integer().notNull(),
    blockHash: varchar({ length: 88 }).notNull(),
    blockTime: bigint({ mode: 'number' }).notNull(),
    tokenAddress: varchar({ length: 44 }).notNull(),
    owner: varchar({ length: 44 }).notNull(),
    amount: numeric().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.blockNumber, table.tokenAddress, table.owner],
    }),
  ],
)

