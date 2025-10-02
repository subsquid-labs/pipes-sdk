import { createEvmDecoder, createEvmPortalSource, createFactory, sqliteFactoryDatabase } from '@sqd-pipes/pipes/evm'

import { events as factoryAbi } from './abi/uniswap.v3/factory'
import { events as swapsAbi } from './abi/uniswap.v3/swaps'

/**
 * This example demonstrates how to use a Factory pattern to decode Uniswap V3 swaps.
 * It creates an EVM Portal Source to stream Ethereum mainnet data, sets up a Factory
 * to track pool creation events, and decodes swap events from the created pools.
 * The pool addresses are stored in an SQLite database for efficient lookup.
 */

async function cli() {
  const stream = createEvmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  }).pipe(
    createEvmDecoder({
      range: { from: '12,369,621' },
      contracts: createFactory({
        address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
        event: factoryAbi.PoolCreated,
        parameter: 'pool',
        database: await sqliteFactoryDatabase({ path: './uniswap3-eth-pools.sqlite' }),
      }),
      events: {
        swaps: swapsAbi.Swap,
      },
    }),
  )

  for await (const { data } of stream) {
    console.log(`parsed ${data.swaps.length} swaps`)
  }
}

void cli()
