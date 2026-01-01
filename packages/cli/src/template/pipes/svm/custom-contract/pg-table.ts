import { bigint, integer, jsonb, pgTable, primaryKey, text, varchar } from 'drizzle-orm/pg-core'

export const customContract = pgTable(
    'custom_contract',
    {
        blockNumber: integer().notNull(),
        blockHash: varchar({ length: 88 }).notNull(),
        transactionIndex: integer().notNull(),
        instructionAddress: text().notNull(),
        programId: varchar({ length: 44 }).notNull(),
        accounts: jsonb().notNull(),
        data: text().notNull(),
        timestamp: bigint({ mode: 'number' }).notNull(),
        // Add here the columns for the custom contract instructions
    },
    (table) => [
        primaryKey({
            columns: [table.blockNumber, table.transactionIndex, table.instructionAddress],
        }),
    ],
)

