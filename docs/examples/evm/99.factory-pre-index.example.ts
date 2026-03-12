import { contractFactory, contractFactoryStore, evmDecoder, evmPortalStream } from '@subsquid/pipes/evm'

import { events as factoryAbi } from './abi/uniswap.v3/factory'
import { events as swapsAbi } from './abi/uniswap.v3/swaps'

/**
 * Example: Declarative factory pre-indexing
 *
 * Setting `preindex: true` causes the factory to automatically
 * index all PoolCreated events before the main stream begins.
 * The portal client and range are resolved from the source configuration.
 */

async function cli() {
  const stream = evmPortalStream({
    id: 'factory-pre-index',
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    outputs: evmDecoder({
      range: { from: '12,369,621' },
      contracts: contractFactory({
        address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
        event: factoryAbi.PoolCreated,
        childAddressField: 'pool',
        preindex: true,
        database: contractFactoryStore({
          path: './uniswap3-eth-pools.sqlite',
        }),
      }),
      events: {
        swaps: swapsAbi.Swap,
      },
    }),
  })

  for await (const { data } of stream) {
    console.log(`parsed ${data.swaps.length} swaps`)
  }
}

void cli()
