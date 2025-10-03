import { createSolanaInstructionDecoder, createSolanaPortalSource } from '@sqd-pipes/pipes/solana'

import * as orcaWhirlpool from './abi/orca_whirlpool/index.js'

async function cli() {
  const stream = createSolanaPortalSource({
    portal: 'https://portal.sqd.dev/datasets/solana-mainnet',
  }).extend({
    orcaWhirlpool: createSolanaInstructionDecoder({
      range: { from: 'latest' },
      programId: orcaWhirlpool.programId,
      instructions: {
        swaps: orcaWhirlpool.instructions.swap,
        swapsV2: orcaWhirlpool.instructions.swapV2,
      },
    }),
  })

  for await (const { data } of stream) {
    console.log(`parsed orca ${data.orcaWhirlpool.swaps.length} swaps`)
  }
}

void cli()
