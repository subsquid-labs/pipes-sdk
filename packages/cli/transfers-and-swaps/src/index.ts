import {
  commonAbis,
  evmDecoder,
  evmPortalSource,
  factory,
  factorySqliteDatabase,
} from '@subsquid/pipes/evm'
import {
  chunk,
  drizzleTarget,
} from '@subsquid/pipes/targets/drizzle/node-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import { events as factoryEvents } from './contracts/factory.js'
import { events as poolEvents } from './contracts/pool.js'
import { transfersTable, uniswapV3Swaps } from './schemas.js'

export async function main() {
  await evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  })
    .pipeComposite({
      transfers: evmDecoder({
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
          from: transfer.event.from,
          to: transfer.event.to,
          value: transfer.event.value,
          tokenAddress: transfer.contract,
          timestamp: transfer.timestamp,
        })),
      ),
      swaps: evmDecoder({
        range: { from: 12_369_621 }, // Uniswap V3 Factory deployment block
        contracts: factory({
          address: ['0x1f98431c8ad98523631ae4a59f267346ea31f984'], // Uniswap V3 Factory address
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
          pool: s.contract,
          timestamp: s.timestamp.getTime(),
          txHash: s.rawEvent.transactionHash,
          blockNumber: s.block.number,
          token0: s.factory?.event.token0 || '',
          token1: s.factory?.event.token1 || '',
          logIndex: s.rawEvent.logIndex,
          ...s.event,
        })),
      ),
    })
    /**
     * Start transforming the data coming from the source.
     * ```ts
     * .pipe(({ contract1 }) => {
     *   return contract1.SomeEvent.map(e => {
     *     // do something
     *   })
     * })
     * ```
     */
    .pipeTo(
      drizzleTarget({
        db: drizzle(
          process.env.DB_CONNECTION_STR ??
            (() => {
              throw new Error('DB_CONNECTION_STR env missing')
            })(),
        ),
        tables: [transfersTable, uniswapV3Swaps],
        onData: async ({ tx, data }) => {
          for (const values of chunk(data.transfers)) {
            await tx.insert(transfersTable).values(values)
          }
          for (const values of chunk(data.swaps)) {
            await tx.insert(uniswapV3Swaps).values(values)
          }
        },
      }),
    )
}
