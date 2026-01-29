import { viewFun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { evmDecoder, evmPortalSource, rpcEnricher } from '@subsquid/pipes/evm'

import { events } from './abi/uniswap.v2/swaps'

/**
 * Example demonstrating rpcEnricher with both immutable and mutable data:
 *
 * 1. IMMUTABLE data (token addresses) - fetched once per pool, cached forever
 * 2. MUTABLE data (reserves) - fetched at each event's block using callOnEventBlock
 *
 * Key concepts:
 * - First enricher: Get token0/token1 addresses (immutable, no callOnEventBlock)
 * - Second enricher: Get reserves at event's block (mutable, callOnEventBlock: true)
 * - Third enricher: Get token metadata using the token addresses from decoded events
 */

// Uniswap V2 Pair functions
const pairFunctions = {
  // Immutable - token addresses never change
  token0: viewFun('0x0dfe1681', 'token0()', {}, p.address),
  token1: viewFun('0xd21220a7', 'token1()', {}, p.address),
  // Mutable - reserves change every block
  getReserves: viewFun(
    '0x0902f1ac',
    'getReserves()',
    {},
    p.struct({
      reserve0: p.uint112,
      reserve1: p.uint112,
      blockTimestampLast: p.uint32,
    }),
  ),
}

async function cli() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  })
    .pipe(
      evmDecoder({
        // Use 'latest' for live data, or a recent range for historical
        range: { from: 'latest' },
        events: {
          swaps: events.Swap,
        },
      }),
    )
    // Step 1: Get immutable pair data (token addresses)
    // No callOnEventBlock - cached by address, fetched once per pool
    .pipe(
      rpcEnricher({
        rpcUrls: ['https://eth.llamarpc.com'],
        addressField: 'contract',
        methods: [pairFunctions.token0, pairFunctions.token1] as const,
      }),
    )
    // Step 2: Get mutable data (reserves) at each event's block
    // With callOnEventBlock - cached by address:block, fetched per block
    .pipe(
      rpcEnricher({
        rpcUrls: ['https://eth.llamarpc.com'],
        addressField: 'contract',
        callOnEventBlock: true,
        methods: [pairFunctions.getReserves] as const,
      }),
    )

  for await (const { data } of stream) {
    for (const swap of data.swaps) {
      const token0 = swap.contractState['token0']
      const token1 = swap.contractState['token1']
      const reserves = swap.contractState['getReserves']

      if (token0 && token1 && reserves) {
        console.log({
          pool: swap.contract,
          block: swap.block.number,
          // Token addresses (immutable)
          token0,
          token1,
          // Pool reserves at this exact block (mutable)
          reserve0: reserves.reserve0,
          reserve1: reserves.reserve1,
          // Swap amounts
          amount0In: swap.event.amount0In,
          amount1In: swap.event.amount1In,
          amount0Out: swap.event.amount0Out,
          amount1Out: swap.event.amount1Out,
        })
      }
    }
  }
}

/**
 * To also get token metadata (name, symbol, decimals), you would need
 * a third enricher that uses the token addresses. However, since rpcEnricher
 * extracts addresses from a field on each item, you'd need to transform
 * the data first to have token0/token1 as addressable fields, or use
 * a custom transformer.
 *
 * Example approach for token metadata:
 *
 * // After getting token0/token1 addresses, create a separate stream
 * // or use a custom transformer to fetch ERC20 metadata:
 *
 * .pipe(
 *   rpcEnricher({
 *     rpcUrls: ['https://eth.llamarpc.com'],
 *     addressField: 'contractState.token0',  // Use the token address we just fetched
 *     methods: [
 *       erc20.functions.name,
 *       erc20.functions.symbol,
 *       erc20.functions.decimals,
 *     ] as const,
 *   }),
 * )
 */

void cli()
