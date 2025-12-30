import { integer, numeric, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core'

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
