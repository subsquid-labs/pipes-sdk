import { createSolanaInstructionDecoder, solanaPortalSource } from '@subsquid/pipes/solana'
import * as meteoraDamm from './abi/meteora-damm/index.js'
import * as meteoraDlmm from './abi/meteora-dlmm/index.js'
import * as orcaWhirlpool from './abi/orca_whirlpool/index.js'
import * as raydiumAmm from './abi/raydium-amm/index.js'
import * as raydiumClmm from './abi/raydium-clmm/index.js'
import * as raydiumCpmm from './abi/raydium-cpmm/index.js'

const from = '340,000,000'

async function cli() {
  const stream = solanaPortalSource({
    portal: 'https://portal.sqd.dev/datasets/solana-mainnet',
  }).pipeComposite({
    orcaWhirlpool: createSolanaInstructionDecoder({
      range: { from },
      programId: orcaWhirlpool.programId,
      instructions: {
        swap: orcaWhirlpool.instructions.swap,
        swapV2: orcaWhirlpool.instructions.swapV2,
      },
    }),
    meteoraDamm: createSolanaInstructionDecoder({
      range: { from },
      programId: meteoraDamm.programId,
      instructions: {
        swap: meteoraDamm.instructions.swap,
      },
    }),
    meteoraDlmm: createSolanaInstructionDecoder({
      range: { from },
      programId: meteoraDamm.programId,
      instructions: {
        swaps: meteoraDlmm.instructions.swap,
        swapExactOut: meteoraDlmm.instructions.swapExactOut,
        swapWithPriceImpact: meteoraDlmm.instructions.swapWithPriceImpact,
      },
    }),
    raydiumAmm: createSolanaInstructionDecoder({
      range: { from },
      programId: raydiumAmm.programId,
      instructions: {
        swapBaseIn: raydiumAmm.instructions.swapBaseIn,
        swapBaseOut: raydiumAmm.instructions.swapBaseOut,
      },
    }),
    raydiumClmm: createSolanaInstructionDecoder({
      range: { from },
      programId: raydiumClmm.programId,
      instructions: {
        swap: raydiumClmm.instructions.swap,
        swapV2: raydiumClmm.instructions.swapV2,
      },
    }),
    raydiumCpmm: createSolanaInstructionDecoder({
      range: { from },
      programId: raydiumCpmm.programId,
      instructions: {
        swapBaseInput: raydiumCpmm.instructions.swapBaseInput,
        swapBaseOutput: raydiumCpmm.instructions.swapBaseOutput,
      },
    }),
  })

  for await (const { data } of stream) {
    console.log(`parsed orca ${data.orcaWhirlpool.swap.length} swaps`)
    console.log(`parsed orca ${data.raydiumAmm.swapBaseIn.length} swaps`)
    console.log(`parsed orca ${data.raydiumAmm.swapBaseOut.length} swaps`)
  }
}

void cli()
