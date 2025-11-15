import { evmDecoder, evmPortalSource, factory, factorySqliteDatabase } from '@sqd-pipes/pipes/evm'
import { events as factoryAbi } from './abi/uniswap.v3/factory'
import { events as swapsAbi } from './abi/uniswap.v3/swaps'

/**
 THIS IS FOR TESTING ONLY!

 Example of using Factory with pre-indexing to decode Uniswap V3 swaps
 from pools created between blocks 12,369,621 and 12,400,000.

- The Factory will pre-index the PoolCreated events in the specified block range
- The Factory will store the created pool addresses in an SQLite database
- The EVM Decoder will decode Swap events from the pools created by the Factory
- The EVM Portal Source will stream blocks from the specified portal
 */

async function cli() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    progress: {
      interval: 500,
    },
  }).pipe(
    evmDecoder({
      range: { from: '12,369,621', to: '12,410,000' },
      contracts: factory({
        address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
        event: factoryAbi.PoolCreated,
        _experimental_preindex: { from: '12,369,621', to: '12,400,000' },
        parameter: 'pool',
        database: factorySqliteDatabase({ path: './uniswap3-eth-pools.sqlite' }),
      }),
      events: {
        swaps: swapsAbi.Swap,
      },
    }),
  )
  //
  for await (const { data } of stream) {
    // console.log('-------------------------------------')
    console.log(`parsed ${data.swaps.length} swaps`)
    // console.log('-------------------------------------')
  }
}

void cli()
