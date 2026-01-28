import { describe, expect, it } from 'vitest'
import { ContractMetadata } from '~/services/sqd-abi.js'
import { Config } from '~/types/init.js'
import { evmTemplates } from '../../templates/pipes/evm/index.js'
import { SinkBuilder } from './index.js'
import { ProjectWriter } from '~/utils/project-writer.js'

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

describe('clickhouse sink template builder', () => {
  it('should render sink for pre-defined template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [
        evmTemplates.erc20Transfers,
      ],
      network: 'ethereum-mainnet',
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }
    const sinkBuilder = new SinkBuilder(config, new ProjectWriter('mock-folder'))

    expect(sinkBuilder.render()).toMatchInlineSnapshot(`
      "
      import path from 'node:path'
      import { clickhouseTarget } from '@subsquid/pipes/targets/clickhouse'
      import { createClient } from '@clickhouse/client'
      import { serializeJsonWithBigInt, toSnakeKeysArray } from './utils/index.js'

      clickhouseTarget({
          client: createClient({
              username: env.CLICKHOUSE_USER,
              password: env.CLICKHOUSE_PASSWORD,
              url: env.CLICKHOUSE_URL,
              database: env.CLICKHOUSE_DATABASE,
              json: {
                  stringify: serializeJsonWithBigInt,
              },
              clickhouse_settings: {
                  date_time_input_format: 'best_effort',
                  date_time_output_format: 'iso',
                  output_format_json_named_tuples_as_objects: 1,
                  output_format_json_quote_64bit_floats: 1,
                  output_format_json_quote_64bit_integers: 1,
              },
          }),
          onStart: async ({ store }) => {
            const migrationsDir = path.join(process.cwd(), 'migrations')
            await store.executeFiles(migrationsDir)
          },
          onData: async ({ data, store }) => {
            await store.insert({
              table: 'erc20_transfers',
              values: toSnakeKeysArray(data.erc20Transfers),
              format: 'JSONEachRow',
            });
          },
          onRollback: async ({ safeCursor, store }) => {
            await store.removeAllRows({
              tables: [
                'erc20_transfers',
              ],
              where: 'block_number > {latest:UInt32}',
              params: { latest: safeCursor.number },
            });
          },
        })"
    `)
  })

  it('should render the sink for custom template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [evmTemplates.custom.setParams({ contracts: wethMetadata })],
      network: 'ethereum-mainnet',
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    const sinkBuilder = new SinkBuilder(config, new ProjectWriter('mock-folder'))

    expect(sinkBuilder.render()).toMatchInlineSnapshot(`
      "
      import path from 'node:path'
      import { clickhouseTarget } from '@subsquid/pipes/targets/clickhouse'
      import { createClient } from '@clickhouse/client'
      import { serializeJsonWithBigInt, toSnakeKeysArray } from './utils/index.js'

      clickhouseTarget({
          client: createClient({
              username: env.CLICKHOUSE_USER,
              password: env.CLICKHOUSE_PASSWORD,
              url: env.CLICKHOUSE_URL,
              database: env.CLICKHOUSE_DATABASE,
              json: {
                  stringify: serializeJsonWithBigInt,
              },
              clickhouse_settings: {
                  date_time_input_format: 'best_effort',
                  date_time_output_format: 'iso',
                  output_format_json_named_tuples_as_objects: 1,
                  output_format_json_quote_64bit_floats: 1,
                  output_format_json_quote_64bit_integers: 1,
              },
          }),
          onStart: async ({ store }) => {
            const migrationsDir = path.join(process.cwd(), 'migrations')
            await store.executeFiles(migrationsDir)
          },
          onData: async ({ data, store }) => {
            await store.insert({
              table: 'weth_9_approval',
              values: toSnakeKeysArray(data.custom.Approval),
              format: 'JSONEachRow',
            });
            await store.insert({
              table: 'weth_9_transfer',
              values: toSnakeKeysArray(data.custom.Transfer),
              format: 'JSONEachRow',
            });
          },
          onRollback: async ({ safeCursor, store }) => {
            await store.removeAllRows({
              tables: [
                'weth_9_approval',
                'weth_9_transfer',
              ],
              where: 'block_number > {latest:UInt32}',
              params: { latest: safeCursor.number },
            });
          },
        })"
    `)
  })
})

describe('postgres sink template builder', () => {
  it('should render sink for pre-defined template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [
        evmTemplates.erc20Transfers,
      ],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    const sinkBuilder = new SinkBuilder(config, new ProjectWriter('mock-folder'))

    expect(sinkBuilder.render()).toMatchInlineSnapshot(`
      "
      import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres',
      import { drizzle } from 'drizzle-orm/node-postgres',
      import {
        erc20TransfersTable,
      } from './schemas.js'

      drizzleTarget({
          db: drizzle(env.DB_CONNECTION_STR),
          tables: [
            erc20TransfersTable,
          ],
          onData: async ({ tx, data }) => {
            for (const values of chunk(data.erc20Transfers)) {
              await tx.insert(erc20TransfersTable).values(values)
            }
          },
        })"
    `)
  })

  it('should render sink for multiple pre-defined templates', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [
        evmTemplates.erc20Transfers,
        evmTemplates.uniswapV3Swaps,
      ],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    const sinkBuilder = new SinkBuilder(config, new ProjectWriter('mock-folder'))

    expect(sinkBuilder.render()).toMatchInlineSnapshot(`
      "
      import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres',
      import { drizzle } from 'drizzle-orm/node-postgres',
      import {
        erc20TransfersTable,
        uniswapV3SwapsTable,
      } from './schemas.js'

      drizzleTarget({
          db: drizzle(env.DB_CONNECTION_STR),
          tables: [
            erc20TransfersTable,
            uniswapV3SwapsTable,
          ],
          onData: async ({ tx, data }) => {
            for (const values of chunk(data.erc20Transfers)) {
              await tx.insert(erc20TransfersTable).values(values)
            }
            for (const values of chunk(data.uniswapV3Swaps)) {
              await tx.insert(uniswapV3SwapsTable).values(values)
            }
          },
        })"
    `)
  })

  it('should render the sink for custom template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [evmTemplates.custom.setParams({ contracts: wethMetadata })],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    const sinkBuilder = new SinkBuilder(config, new ProjectWriter('mock-folder'))

    expect(sinkBuilder.render()).toMatchInlineSnapshot(`
      "
      import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres',
      import { drizzle } from 'drizzle-orm/node-postgres',
      import {
        weth9ApprovalTable,
        weth9TransferTable,
      } from './schemas.js'

      drizzleTarget({
          db: drizzle(env.DB_CONNECTION_STR),
          tables: [
            weth9ApprovalTable,
            weth9TransferTable,
          ],
          onData: async ({ tx, data }) => {
            for (const values of chunk(data.custom.Approval)) {
              await tx.insert(weth9ApprovalTable).values(values)
            }
            for (const values of chunk(data.custom.Transfer)) {
              await tx.insert(weth9TransferTable).values(values)
            }
          },
        })"
    `)
  })

  it('should render the sink for custom and pre-defined templates', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [
        evmTemplates.erc20Transfers,
        evmTemplates.custom.setParams({ contracts: wethMetadata }),
      ],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    const sinkBuilder = new SinkBuilder(config, new ProjectWriter('mock-folder'))

    expect(sinkBuilder.render()).toMatchInlineSnapshot(`
      "
      import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres',
      import { drizzle } from 'drizzle-orm/node-postgres',
      import {
        erc20TransfersTable,
        weth9ApprovalTable,
        weth9TransferTable,
      } from './schemas.js'

      drizzleTarget({
          db: drizzle(env.DB_CONNECTION_STR),
          tables: [
            erc20TransfersTable,
            weth9ApprovalTable,
            weth9TransferTable,
          ],
          onData: async ({ tx, data }) => {
            for (const values of chunk(data.erc20Transfers)) {
              await tx.insert(erc20TransfersTable).values(values)
            }
            for (const values of chunk(data.custom.Approval)) {
              await tx.insert(weth9ApprovalTable).values(values)
            }
            for (const values of chunk(data.custom.Transfer)) {
              await tx.insert(weth9TransferTable).values(values)
            }
          },
        })"
    `)
  })
})
