import { describe, expect, it } from 'vitest'
import { Config } from '~/types/init.js'
import { evmTemplates } from '../pipe-templates/evm/index.js'
import { EvmTemplateBuilder } from './evm-template-builder.js'

describe('EVM Template Builder', () => {
  it('should build index.ts file using single pipe template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates['erc20Transfers']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    const indexerContent = new EvmTemplateBuilder(config).build()

    expect(indexerContent).toMatchInlineSnapshot(`
      "import "dotenv/config";
      import { commonAbis, evmDecoder, evmPortalSource } from "@subsquid/pipes/evm";
      import { z } from "zod";
      import { clickhouseTarget } from "@subsquid/pipes/targets/clickhouse";
      import { createClient } from "@clickhouse/client";
      import { serializeJsonWithBigInt, toSnakeKeysArray } from "./utils/index.js";

      const env = z.object({
        CLICKHOUSE_USER: z.string(),
        CLICKHOUSE_PASSWORD: z.string(),
        CLICKHOUSE_URL: z.string(),
      }).parse(process.env)

      const erc20Transfers = evmDecoder({
        profiler: { id: 'erc20-transfers' }, // Optional: add a profiler to measure the performance of the transformer
        range: { from: 'latest' },
        // Uncomment the line below to filter by contract addresses
        // contracts: ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"], // WETH on Ethereum mainnet
        events: {
          transfers: commonAbis.erc20.events.Transfer,
        },
      }).pipe(({ transfers }) =>
        transfers.map((transfer) => ({
          blockNumber: transfer.block.number,
          txHash: transfer.rawEvent.transactionHash,
          logIndex: transfer.rawEvent.logIndex,
          timestamp: transfer.timestamp.getTime(),
          from: transfer.event.from,
          to: transfer.event.to,
          value: transfer.event.value,
          tokenAddress: transfer.contract,
        })),
      )

      export async function main() {
        await evmPortalSource({
          portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
        })
        .pipeComposite({
          erc20Transfers,
        })
        /**
         * You can further transform the data coming from the source
         * \`\`\`ts
         * .pipe(({ contract1 }) => {
         *   return contract1.SomeEvent.map(e => {
         *     // some transformation logic
         *   })
         * })
         * \`\`\`
         */
        .pipeTo(clickhouseTarget({
          client: createClient({
              username: env.CLICKHOUSE_USER,
              password: env.CLICKHOUSE_PASSWORD,
              url: env.CLICKHOUSE_URL,
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
            await store.executeFiles('./src/migrations')
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
        }))
      }

      void main()
      "
    `)
  })

  it('should build index.ts combining multiple pipe templates', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates['erc20Transfers'], evmTemplates['uniswapV3Swaps']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    const indexerContent = new EvmTemplateBuilder(config).build()

    expect(indexerContent).toMatchInlineSnapshot(`
      "import "dotenv/config";
      import { commonAbis, evmDecoder, evmPortalSource, factory, factorySqliteDatabase } from "@subsquid/pipes/evm";
      import { z } from "zod";
      import { clickhouseTarget } from "@subsquid/pipes/targets/clickhouse";
      import { createClient } from "@clickhouse/client";
      import { serializeJsonWithBigInt, toSnakeKeysArray } from "./utils/index.js";
      import { events as factoryEvents } from "./contracts/factory.js";
      import { events as poolEvents } from "./contracts/pool.js";

      const env = z.object({
        CLICKHOUSE_USER: z.string(),
        CLICKHOUSE_PASSWORD: z.string(),
        CLICKHOUSE_URL: z.string(),
      }).parse(process.env)

      const erc20Transfers = evmDecoder({
        profiler: { id: 'erc20-transfers' }, // Optional: add a profiler to measure the performance of the transformer
        range: { from: 'latest' },
        // Uncomment the line below to filter by contract addresses
        // contracts: ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"], // WETH on Ethereum mainnet
        events: {
          transfers: commonAbis.erc20.events.Transfer,
        },
      }).pipe(({ transfers }) =>
        transfers.map((transfer) => ({
          blockNumber: transfer.block.number,
          txHash: transfer.rawEvent.transactionHash,
          logIndex: transfer.rawEvent.logIndex,
          timestamp: transfer.timestamp.getTime(),
          from: transfer.event.from,
          to: transfer.event.to,
          value: transfer.event.value,
          tokenAddress: transfer.contract,
        })),
      )

      const uniswapV3Swaps = evmDecoder({
        range: { from: 'latest' }, // Uniswap V3 Factory deployment block: 12,369,621
        contracts: factory({
          address: ['0x1f98431c8ad98523631ae4a59f267346ea31f984'], // Uniswap V3 Factory address on Ethereum mainnet. Replace with the factory address for the network you are using.
          event: factoryEvents.PoolCreated,
          parameter: 'pool',
          database: await factorySqliteDatabase({
            path: './uniswap3-eth-pools.sqlite',
          }),
        }),
        events: {
          swaps: poolEvents.Swap,
        },
      }).pipe(({ swaps }) =>
        swaps.map((s) => ({
          blockNumber: s.block.number,
          txHash: s.rawEvent.transactionHash,
          logIndex: s.rawEvent.logIndex,
          timestamp: s.timestamp.getTime(),
          pool: s.contract,
          token0: s.factory?.event.token0 ?? '',
          token1: s.factory?.event.token1 ?? '',
          ...s.event,
        })),
      )

      export async function main() {
        await evmPortalSource({
          portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
        })
        .pipeComposite({
          erc20Transfers,
          uniswapV3Swaps,
        })
        /**
         * You can further transform the data coming from the source
         * \`\`\`ts
         * .pipe(({ contract1 }) => {
         *   return contract1.SomeEvent.map(e => {
         *     // some transformation logic
         *   })
         * })
         * \`\`\`
         */
        .pipeTo(clickhouseTarget({
          client: createClient({
              username: env.CLICKHOUSE_USER,
              password: env.CLICKHOUSE_PASSWORD,
              url: env.CLICKHOUSE_URL,
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
            await store.executeFiles('./src/migrations')
          },
          onData: async ({ data, store }) => {
            await store.insert({
              table: 'erc20_transfers',
              values: toSnakeKeysArray(data.erc20Transfers),
              format: 'JSONEachRow',
            });
            await store.insert({
              table: 'uniswap_v3_swaps',
              values: toSnakeKeysArray(data.uniswapV3Swaps),
              format: 'JSONEachRow',
            });
          },
          onRollback: async ({ safeCursor, store }) => {
            await store.removeAllRows({
              tables: [
                'erc20_transfers',
                'uniswap_v3_swaps',
              ],
              where: 'block_number > {latest:UInt32}',
              params: { latest: safeCursor.number },
            });
          },
        }))
      }

      void main()
      "
    `)
  })

  it('should build custom contract template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates['custom']],
      contractAddresses: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    const indexerContent = new EvmTemplateBuilder(config).build()

    expect(indexerContent).toMatchInlineSnapshot(`
      "import "dotenv/config";
      import { evmDecoder, evmPortalSource } from "@subsquid/pipes/evm";
      import { z } from "zod";
      import { chunk, drizzleTarget } from "@subsquid/pipes/targets/drizzle/node-postgres";
      import { drizzle } from "drizzle-orm/node-postgres";
      import { customContractTable } from "./schemas.js";
      import { events as myContractEvents } from "./contracts/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.js";

      const env = z.object({
        DB_CONNECTION_STR: z.string(),
      }).parse(process.env)

      const custom = evmDecoder({
        range: { from: 'latest' },
        contracts: ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"],
        /**
         * Or optionally use only a subset of events by passing the events object directly:
         * \`\`\`ts
         * events: {
         *   transfers: myContractEvents.events.SomeEvent,
         * },
         * \`\`\`
         */
        events: myContractEvents,
      })

      export async function main() {
        await evmPortalSource({
          portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
        })
        .pipeComposite({
          custom,
        })
        /**
         * You can further transform the data coming from the source
         * \`\`\`ts
         * .pipe(({ contract1 }) => {
         *   return contract1.SomeEvent.map(e => {
         *     // some transformation logic
         *   })
         * })
         * \`\`\`
         */
        .pipeTo(drizzleTarget({
          db: drizzle(env.DB_CONNECTION_STR),
          tables: [
            customContractTable,
          ],
          onData: async ({ tx, data }) => {
            /**
             * Once the data is transformed, you can insert it into the database.
             *  
             * for (const values of chunk(data.custom.MyContractEvent)) {
             *   await tx.insert(customContract).values(values)
             * }
             */
          },
        }))
      }

      void main()
      "
    `)
  })
})
