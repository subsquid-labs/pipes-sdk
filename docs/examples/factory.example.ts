import { createEvmDecoder, createEvmPortalSource, createFactory, sqliteFactoryDatabase } from '@sqd-pipes/pipes/evm'
import { events as factoryAbi } from './contracts/uniswap.v3/factory'
import { events as swapsAbi } from './contracts/uniswap.v3/swaps'

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

  for await (const { data, ctx } of stream) {
    // console.log('-------------------------------------')
    console.log(`parsed ${data.swaps.length} swaps`)
    console.log(ctx.profiler.toString())
    // console.log('-------------------------------------')
  }
}

void cli()
