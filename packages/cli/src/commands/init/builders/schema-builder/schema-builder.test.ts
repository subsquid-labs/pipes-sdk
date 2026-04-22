import { describe, expect, it } from 'vitest'

import { fixtures, wethContract } from '../../templates/test-fixtures.js'
import { renderSchemasTemplate } from './index.js'

const ctx = {
  network: 'ethereum-mainnet',
  projectPath: '',
  networkType: 'evm' as const,
}

function renderAll(tuples: Array<{ template: any; params: any }>) {
  return renderSchemasTemplate(tuples.map((t) => t.template.render(t.params, ctx).postgresSchema))
}

describe('Schema template builder', () => {
  it('should build schema file for single pipe template', () => {
    const schemaContent = renderAll([fixtures.erc20Transfers()])

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
    const schemaContent = renderAll([fixtures.erc20Transfers(), fixtures.uniswapV3Swaps()])

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

  it('should build schema for custom contract', () => {
    const schemaContent = renderAll([fixtures.evmCustom([wethContract])])

    expect(schemaContent).toMatchInlineSnapshot(`
      "import { bigint, char, integer, pgTable, primaryKey, numeric } from "drizzle-orm/pg-core";

      export const weth9ApprovalTable = pgTable(
        'weth_9_approval',
        {
          blockNumber: integer().notNull(),
          txHash: char({ length: 66 }).notNull(),
          logIndex: integer().notNull(),
          timestamp: bigint({ mode: 'number' }).notNull(),

          src: char({ length: 42 }),
          guy: char({ length: 42 }),
          wad: numeric({ precision: 78, scale: 0 }),
        },
        (table) => [
          primaryKey({
            columns: [table.blockNumber, table.txHash, table.logIndex],
          }),
        ],
      )

      export const weth9TransferTable = pgTable(
        'weth_9_transfer',
        {
          blockNumber: integer().notNull(),
          txHash: char({ length: 66 }).notNull(),
          logIndex: integer().notNull(),
          timestamp: bigint({ mode: 'number' }).notNull(),

          src: char({ length: 42 }),
          dst: char({ length: 42 }),
          wad: numeric({ precision: 78, scale: 0 }),
        },
        (table) => [
          primaryKey({
            columns: [table.blockNumber, table.txHash, table.logIndex],
          }),
        ],
      )

      export default {
        weth9ApprovalTable,
        weth9TransferTable,
      }
      "
    `)
  })
})
