import Mustache from 'mustache'
import { UniswapV3SwapsPipeTemplateParams } from '../template.config.js'

const template = `import { evmDecoder, factory, factorySqliteDatabase } from '@subsquid/pipes/evm'
import { events as factoryEvents } from './contracts/factory.js'
import { events as poolEvents } from './contracts/pool.js'

const uniswapV3Swaps = evmDecoder({
  range: { from: '{{{range.from}}}'{{#range.to}}, to: '{{{range.to}}}'{{/range.to}} },
  contracts: factory({
    address: [
      '{{factoryAddress}}',
    ],
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
`

export function renderTemplate(params: UniswapV3SwapsPipeTemplateParams) {
  return Mustache.render(template, params)
}
