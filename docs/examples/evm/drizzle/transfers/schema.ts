import { integer, numeric, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core'

export const transfersTable = pgTable(
  'transfers',
  {
    blockNumber: integer().notNull(),
    logIndex: integer().notNull(),
    transactionIndex: integer().notNull(),
    from: varchar().notNull(),
    to: varchar().notNull(),
    amount: numeric({ mode: 'bigint' }).notNull(),
    createdAt: timestamp(),
  },
  (table) => [
    primaryKey({
      columns: [table.blockNumber, table.transactionIndex, table.logIndex],
    }),
  ],
)
