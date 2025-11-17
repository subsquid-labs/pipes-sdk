import { PortalRange } from '@subsquid/pipes'
import { factory as createFactory, evmDecoder, FactoryPersistentAdapter } from '@subsquid/pipes/evm'

import { events as factoryAbi } from '../abi/uniswap.v3/factory'
import { events as swapsAbi } from '../abi/uniswap.v3/swaps'

export const uniswapV3 = {
  ethereum: {
    mainnet: {
      factory: '0x1f98431c8ad98523631ae4a59f267346ea31f984'.toLowerCase(),
      range: { from: '12,369,621' },
    },
  },
  base: {
    mainnet: {
      factory: '0x33128a8fc17869897dce68ed026d694621f6fdfd'.toLowerCase(),
      range: { from: '1,371,680' },
    },
  },
} as const

export function uniswapV3Decoder({
  range,
  factory,
}: {
  range: PortalRange
  factory: {
    address: string
    database: Promise<FactoryPersistentAdapter<any>> | FactoryPersistentAdapter<any>
  }
}) {
  return evmDecoder({
    profiler: { id: 'UniswapV3 decode' },
    range: range || { from: 'latest' },
    contracts: createFactory({
      address: factory.address,
      event: factoryAbi.PoolCreated,
      parameter: (e) => e.pool,
      database: factory.database,
    }),
    events: {
      swaps: swapsAbi.Swap,
    },
  })
}
