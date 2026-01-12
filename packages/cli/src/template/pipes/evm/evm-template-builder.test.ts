import { describe, expect, it } from 'vitest'
import { templates } from '~/template/index.js'
import { Config } from '~/types/config.js'
import { EvmTemplateBuilder } from './evm-template-builder.js'

describe('EVM Template Builder', () => {
  it('should build index.ts file using single pipe template', () => {
    const config: Config<'evm'> = {
      projectFolder: 'mock-folder',
      chainType: 'evm',
      network: 'ethereum-mainnet',
      templates: {
        'erc20-transfers': templates.evm['erc20-transfers'],
      },
      contractAddresses: [],
      sink: 'clickhouse',
    }

    const indexerContent = new EvmTemplateBuilder(config).build()

    expect(indexerContent).toMatchInlineSnapshot(`
      "import "dotenv/config";
      import { commonAbis, evmDecoder, evmPortalSource } from "@subsquid/pipes/evm";
      import { clickhouseTarget } from "@subsquid/pipes/targets/clickhouse";
      import { createClient } from "@clickhouse/client";
      import { serializeJsonWithBigInt, toSnakeKeysArray } from "./utils/index.js";

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
         * Start transforming the data coming from the source.
         * \`\`\`ts
         * .pipe(({ contract1 }) => {
         *   return contract1.SomeEvent.map(e => {
         *     // do something
         *   })
         * })
         * \`\`\`
         */
        .pipeTo(clickhouseTarget({
          client: createClient({
              username: process.env.CLICKHOUSE_USER ?? (() => { throw new Error('CLICKHOUSE_USER is not set')})(),
              password: process.env.CLICKHOUSE_PASSWORD ?? (() => { throw new Error('CLICKHOUSE_PASSWORD is not set')})(),
              url: process.env.CLICKHOUSE_URL ?? (() => { throw new Error('CLICKHOUSE_URL is not set')})(),
              json: {
                  stringify: serializeJsonWithBigInt,
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
      chainType: 'evm',
      network: 'ethereum-mainnet',
      templates: {
        'erc20-transfers': templates.evm['erc20-transfers'],
        'uniswap-v3-swaps': templates.evm['uniswap-v3-swaps'],
      },
      contractAddresses: [],
      sink: 'clickhouse',
    }

    const indexerContent = new EvmTemplateBuilder(config).build()

    expect(indexerContent).toMatchInlineSnapshot(`
      "import "dotenv/config";
      import { commonAbis, evmDecoder, evmPortalSource, factory, factorySqliteDatabase } from "@subsquid/pipes/evm";
      import { events as factoryEvents } from "./contracts/factory.js";
      import { events as poolEvents } from "./contracts/pool.js";
      import { clickhouseTarget } from "@subsquid/pipes/targets/clickhouse";
      import { createClient } from "@clickhouse/client";
      import { serializeJsonWithBigInt, toSnakeKeysArray } from "./utils/index.js";

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
         * Start transforming the data coming from the source.
         * \`\`\`ts
         * .pipe(({ contract1 }) => {
         *   return contract1.SomeEvent.map(e => {
         *     // do something
         *   })
         * })
         * \`\`\`
         */
        .pipeTo(clickhouseTarget({
          client: createClient({
              username: process.env.CLICKHOUSE_USER ?? (() => { throw new Error('CLICKHOUSE_USER is not set')})(),
              password: process.env.CLICKHOUSE_PASSWORD ?? (() => { throw new Error('CLICKHOUSE_PASSWORD is not set')})(),
              url: process.env.CLICKHOUSE_URL ?? (() => { throw new Error('CLICKHOUSE_URL is not set')})(),
              json: {
                  stringify: serializeJsonWithBigInt,
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
})
