import { createEvmPortalSource, sqliteFactoryDatabase } from '@sqd-pipes/pipes/evm'
import { erc20Transfers, uniswapV3, uniswapV3Decoder } from './decoders'

async function cli() {
  const range = { from: '20,000,000', to: '+1,000' }

  const stream = createEvmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/base-mainnet',
  }).extend({
    transfers: erc20Transfers({ range }),
    uniswapV3: uniswapV3Decoder({
      range,
      factory: {
        address: uniswapV3.base.mainnet.factory,
        database: await sqliteFactoryDatabase({ path: './uniswap-v3-pools.sqlite' }),
      },
    }),
  })

  for await (const { data } of stream) {
    console.log('-------------------------------------')
    console.log(`parsed ${data.transfers.length} transfers`)
    console.log(`parsed ${data.uniswapV3.swaps.length} swaps`)
    console.log('-------------------------------------')
  }
}

void cli()
