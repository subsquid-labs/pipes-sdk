import { bigint, integer, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core'

export const customContractTable = pgTable(
  'custom_contract',
  {
    blockNumber: integer().notNull(),
    txHash: varchar({ length: 66 }).notNull(),
    logIndex: integer().notNull(),
    timestamp: bigint({ mode: 'number' }).notNull(),
    // Add here the columns for the custom contract events
  },
  (table) => [
    primaryKey({
      columns: [table.blockNumber, table.txHash, table.logIndex],
    }),
  ],
)
