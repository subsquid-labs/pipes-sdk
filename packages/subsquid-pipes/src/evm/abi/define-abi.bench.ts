import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { decodeEventLog, parseAbi } from 'viem'
import { bench, describe } from 'vitest'

import { defineAbi } from './define-abi.js'

// Uniswap V3 Swap event — a realistic, non-trivial event with 7 params
const swapJsonAbi = [
  {
    type: 'event',
    name: 'Swap',
    inputs: [
      { indexed: true, name: 'sender', type: 'address' },
      { indexed: true, name: 'recipient', type: 'address' },
      { indexed: false, name: 'amount0', type: 'int256' },
      { indexed: false, name: 'amount1', type: 'int256' },
      { indexed: false, name: 'sqrtPriceX96', type: 'uint160' },
      { indexed: false, name: 'liquidity', type: 'uint128' },
      { indexed: false, name: 'tick', type: 'int24' },
    ],
  },
] as const

const topics: `0x${string}`[] = [
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
  '0x000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564',
]

const data: `0x${string}` =
  '0xfffffffffffffffffffffffffffffffffffffffffffffffffff129c0864c6000000000000000000000000000000000000000000000000000002386f26fc10000000000000000000000000000000000000000000000066a39008b1e49bf1e8c9330000000000000000000000000000000000000000000000008ac7230489e8000000000000000000000000000000000000000000000000000000000000000002f6c4'

// --- pre-built decoders (outside benchmark loop) ---

// 1) generated subsquid (hand-written, like codegen output)
const generatedSwap = event(
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  'Swap(address,address,int256,int256,uint160,uint128,int24)',
  {
    sender: indexed(p.address),
    recipient: indexed(p.address),
    amount0: p.int256,
    amount1: p.int256,
    sqrtPriceX96: p.uint160,
    liquidity: p.uint128,
    tick: p.int24,
  },
)

// 2) defineAbi (pre-resolve the event, same as you'd do in real code)
const definedSwap = defineAbi(swapJsonAbi).events.Swap

// 3) viem
const viemAbi = parseAbi([
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
])

const swapLog = { topics, data }

describe('decode Uniswap V3 Swap event', () => {
  bench('subsquid defineAbi', () => {
    definedSwap.decode(swapLog)
  })

  bench('viem decodeEventLog', () => {
    decodeEventLog({
      abi: viemAbi,
      topics: [topics[0], topics[1], topics[2]],
      data,
    })
  })

  bench('subsquid generated', () => {
    generatedSwap.decode(swapLog)
  })
})
