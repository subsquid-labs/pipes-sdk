import { describe, expect, it } from 'vitest'

import { Config } from '~/types/init.js'

import { fixtures, overloadedApprovalContract, seaportContract, wethContract } from '../../templates/test-fixtures.js'
import { buildClickhouseSink, buildPostgresSink, buildSink } from './index.js'

describe('clickhouse sink template builder', () => {
  it('should render sink for pre-defined template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.erc20Transfers()],
      network: 'ethereum-mainnet',
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }
    expect(buildSink(config).sinkCode).toMatchInlineSnapshot(`
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
                  input_format_skip_unknown_fields: 1,
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
      templates: [fixtures.evmCustom([wethContract])],
      network: 'ethereum-mainnet',
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    expect(buildSink(config).sinkCode).toMatchInlineSnapshot(`
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
                  input_format_skip_unknown_fields: 1,
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
      templates: [fixtures.erc20Transfers()],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    expect(buildSink(config).sinkCode).toMatchInlineSnapshot(`
      "
      import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres'
      import { drizzle } from 'drizzle-orm/node-postgres'
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
      templates: [fixtures.erc20Transfers(), fixtures.uniswapV3Swaps()],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    expect(buildSink(config).sinkCode).toMatchInlineSnapshot(`
      "
      import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres'
      import { drizzle } from 'drizzle-orm/node-postgres'
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
      templates: [fixtures.evmCustom([wethContract])],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    expect(buildSink(config).sinkCode).toMatchInlineSnapshot(`
      "
      import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres'
      import { drizzle } from 'drizzle-orm/node-postgres'
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
      templates: [fixtures.erc20Transfers(), fixtures.evmCustom([wethContract])],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    expect(buildSink(config).sinkCode).toMatchInlineSnapshot(`
      "
      import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres'
      import { drizzle } from 'drizzle-orm/node-postgres'
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

describe('buildPostgresSink artifacts', () => {
  const config: Config<'evm'> = {
    projectFolder: 'mock-folder',
    networkType: 'evm',
    templates: [fixtures.erc20Transfers()],
    network: 'ethereum-mainnet',
    sink: 'postgresql',
    packageManager: 'pnpm',
  }

  it('returns the postgres env schema', () => {
    expect(buildPostgresSink(config).envSchema).toMatchInlineSnapshot(`
      "
      import { z } from 'zod'

      const env = z.object({
        DB_CONNECTION_STR: z.string(),
      }).parse(process.env)
      "
    `)
  })

  it('returns files for .env, src/schemas.ts, and drizzle.config.ts', () => {
    const files = buildPostgresSink(config).files
    expect(files.map((f) => f.path)).toEqual(['.env', 'src/schemas.ts', 'drizzle.config.ts'])
    expect(files.find((f) => f.path === '.env')!.content).toContain('DB_CONNECTION_STR=postgresql://')
    expect(files.find((f) => f.path === 'src/schemas.ts')!.content).toContain('erc20TransfersTable')
    expect(files.find((f) => f.path === 'drizzle.config.ts')!.content.length).toBeGreaterThan(0)
  })

  it('returns a single db:generate post step using the configured package manager', () => {
    expect(buildPostgresSink(config).postSteps).toEqual([
      { kind: 'exec', command: 'pnpm run db:generate' },
    ])
  })
})

describe('buildClickhouseSink artifacts', () => {
  const config: Config<'evm'> = {
    projectFolder: 'mock-folder',
    networkType: 'evm',
    templates: [fixtures.erc20Transfers(), fixtures.evmCustom([wethContract])],
    network: 'ethereum-mainnet',
    sink: 'clickhouse',
    packageManager: 'pnpm',
  }

  it('returns the clickhouse env schema', () => {
    expect(buildClickhouseSink(config).envSchema).toMatchInlineSnapshot(`
      "
      import { z } from 'zod'

      const env = z.object({
        CLICKHOUSE_USER: z.string(),
        CLICKHOUSE_PASSWORD: z.string(),
        CLICKHOUSE_URL: z.string(),
        CLICKHOUSE_DATABASE: z.string(),
      }).parse(process.env)
      "
    `)
  })

  it('returns .env and one migrations file per template', () => {
    const files = buildClickhouseSink(config).files
    expect(files.map((f) => f.path)).toEqual([
      '.env',
      'migrations/erc20Transfers-migration.sql',
      'migrations/custom-migration.sql',
    ])
    expect(files.find((f) => f.path === '.env')!.content).toContain('CLICKHOUSE_URL=http://localhost:')
  })

  it('returns an empty postSteps array', () => {
    expect(buildClickhouseSink(config).postSteps).toEqual([])
  })
})

describe('buildSink dispatch', () => {
  it('throws an unsupported error for memory sink', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.erc20Transfers()],
      network: 'ethereum-mainnet',
      sink: 'memory',
      packageManager: 'pnpm',
    }
    expect(() => buildSink(config)).toThrow(/Memory sink is not supported/)
  })
})

describe('shared-decoder contract-address discriminator', () => {
  const usdcContract = {
    contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    contractName: 'USDC',
    contractEvents: wethContract.contractEvents,
    range: { from: 'latest' },
  }

  it('adds contractAddress column to postgres schema when decoder is shared', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.evmCustom([wethContract, usdcContract])],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    const schema = buildPostgresSink(config).files.find((f) => f.path === 'src/schemas.ts')!.content
    expect(schema).toContain('contractAddress: char({ length: 42 }).notNull()')
  })

  it('adds contract_address column to clickhouse DDL when decoder is shared', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.evmCustom([wethContract, usdcContract])],
      network: 'ethereum-mainnet',
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }
    const migration = buildClickhouseSink(config).files.find((f) => f.path.includes('migrations/'))!.content
    expect(migration).toContain('contract_address LowCardinality(FixedString(42))')
  })

  it('omits the discriminator when decoder is per-contract (not shared)', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.evmCustom([wethContract])],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    const schema = buildPostgresSink(config).files.find((f) => f.path === 'src/schemas.ts')!.content
    expect(schema).not.toContain('contractAddress: char({ length: 42 })')
  })
})

describe('overloaded events', () => {
  it('emits distinct postgres tables for events with the same name', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.evmCustom([overloadedApprovalContract])],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    const schema = buildPostgresSink(config).files.find((f) => f.path === 'src/schemas.ts')!.content
    const approvalTableDecls = schema.match(/'overloaded_token_approval(_[0-9a-f]{4})?'/g) ?? []
    expect(approvalTableDecls).toHaveLength(2)
    expect(new Set(approvalTableDecls).size).toBe(2)
    expect(schema).toContain("'overloaded_token_transfer'")
  })

  it('emits distinct clickhouse tables for events with the same name', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.evmCustom([overloadedApprovalContract])],
      network: 'ethereum-mainnet',
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }
    const migration = buildClickhouseSink(config).files.find((f) => f.path.includes('migrations/'))!.content
    const approvalCreates = migration.match(/CREATE TABLE IF NOT EXISTS overloaded_token_approval(_[0-9a-f]{4})?/g) ?? []
    expect(approvalCreates).toHaveLength(2)
    expect(new Set(approvalCreates).size).toBe(2)
  })
})

describe('tuple[] event inputs', () => {
  it('renders postgres schema with jsonb columns for tuple-array inputs', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.evmCustom([seaportContract])],
      network: 'ethereum-mainnet',
      sink: 'postgresql',
      packageManager: 'pnpm',
    }
    const files = buildPostgresSink(config).files.map((f) => ({ path: f.path, content: f.content }))
    const schema = files.find((f) => f.path === 'src/schemas.ts')!
    expect(schema.content).toContain('offer: jsonb()')
    expect(schema.content).toContain('consideration: jsonb()')
  })

  it('renders clickhouse DDL with JSON columns for tuple-array inputs', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      templates: [fixtures.evmCustom([seaportContract])],
      network: 'ethereum-mainnet',
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }
    const files = buildClickhouseSink(config).files.map((f) => ({ path: f.path, content: f.content }))
    const migration = files.find((f) => f.path.includes('migrations/'))!
    expect(migration.content).toMatch(/offer\s+JSON/)
    expect(migration.content).toMatch(/consideration\s+JSON/)
  })
})
