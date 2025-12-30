import { evmDecoder, factory, factorySqliteDatabase } from '@subsquid/pipes/evm'
import { events as factoryEvents } from './contracts/factory.js'
import { events as poolEvents } from './contracts/pool.js'

evmDecoder({
  range: { from: 'latest' }, // Uniswap V3 Factory deployment block: 12,369,621
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
