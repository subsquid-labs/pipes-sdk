import { describe, expect, it } from 'vitest'
import { ContractMetadata } from '~/services/sqd-abi.js'
import { Config } from '~/types/init.js'
import { evmTemplates } from '../../templates/pipes/evm/index.js'
import { renderSchemasTemplate } from './index.js'

const wethMetadata: ContractMetadata[] = [
  {
    contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    contractName: 'WETH9',
    contractEvents: [
      {
        inputs: [
          {
            name: 'src',
            type: 'address',
          },
          {
            name: 'guy',
            type: 'address',
          },
          {
            name: 'wad',
            type: 'uint256',
          },
        ],
        name: 'Approval',
        type: 'event',
      },
      {
        inputs: [
          {
            name: 'src',
            type: 'address',
          },
          {
            name: 'dst',
            type: 'address',
          },
          {
            name: 'wad',
            type: 'uint256',
          },
        ],
        name: 'Transfer',
        type: 'event',
      },
    ],
  },
]

describe('Schema template builder', () => {
  it('should build schema file for single pipe template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates.erc20Transfers],
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    const schemaContent = renderSchemasTemplate(config.templates.map((t) => t.renderPostgresSchemas()))

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
        evmTemplates.erc20Transfers,
        evmTemplates.uniswapV3Swaps,
      ],
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    const schemaContent = renderSchemasTemplate(config.templates.map((t) => t.renderPostgresSchemas()))

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
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [evmTemplates.custom.setParams({ contracts: wethMetadata })],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    const schemaContent = renderSchemasTemplate(config.templates.map((t) => t.renderPostgresSchemas()))

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
