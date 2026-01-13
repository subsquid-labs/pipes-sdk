import { describe, expect, it } from 'vitest'
import { Config } from '~/types/init.js'
import { renderSchemasTemplate } from './schemas-template.js'
import { templates } from './template-builder.js'

describe('Schema template builder', () => {
  it('should build schema file for single pipe template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [templates.evm['erc20-transfers']],
      contractAddresses: [],
      sink: 'postgresql',
    }

    const schemaContent = renderSchemasTemplate(config)

    expect(schemaContent).toMatchInlineSnapshot(`
      "import { bigint, integer, numeric, pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

      export const erc20TransfersTable = pgTable(
        'erc20_transfers',
        {
          blockNumber: integer().notNull(),
          txHash: varchar({ length: 66 }).notNull(),
          logIndex: integer().notNull(),
          timestamp: bigint({ mode: 'number' }).notNull(),
          from: varchar({ length: 42 }).notNull(),
          to: varchar({ length: 42 }).notNull(),
          value: numeric({ mode: 'bigint' }).notNull(),
          tokenAddress: varchar({ length: 42 }).notNull(),
        },
        (table) => [
          primaryKey({
            columns: [table.blockNumber, table.txHash, table.logIndex],
          }),
        ],
      )

      export default {
        erc20TransfersTable,
      }
      "
    `)
  })

  it('should build schema file for multiple pipe templates', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [
        templates.evm['erc20-transfers'],
        templates.evm['uniswap-v3-swaps'],
      ],
      contractAddresses: [],
      sink: 'postgresql',
    }

    const schemaContent = renderSchemasTemplate(config)

    expect(schemaContent).toMatchInlineSnapshot(`
      "import { bigint, integer, numeric, pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

      export const erc20TransfersTable = pgTable(
        'erc20_transfers',
        {
          blockNumber: integer().notNull(),
          txHash: varchar({ length: 66 }).notNull(),
          logIndex: integer().notNull(),
          timestamp: bigint({ mode: 'number' }).notNull(),
          from: varchar({ length: 42 }).notNull(),
          to: varchar({ length: 42 }).notNull(),
          value: numeric({ mode: 'bigint' }).notNull(),
          tokenAddress: varchar({ length: 42 }).notNull(),
        },
        (table) => [
          primaryKey({
            columns: [table.blockNumber, table.txHash, table.logIndex],
          }),
        ],
      )

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

      export default {
        erc20TransfersTable,
        uniswapV3SwapsTable,
      }
      "
    `)
  })
})
