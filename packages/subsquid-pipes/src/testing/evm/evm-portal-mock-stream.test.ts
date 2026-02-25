import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import { commonAbis } from '~/evm/abi/common.js'
import { evmDecoder } from '~/evm/evm-decoder.js'
import { evmPortalSource } from '~/evm/evm-portal-source.js'
import { factory } from '~/evm/factory.js'
import { factorySqliteDatabase } from '~/evm/factory-adapters/sqlite.js'

import { MockPortal, closeMockPortal, readAll } from '../index.js'
import { encodeEvent, evmPortalMockStream, mockBlock, resetMockBlockCounter } from './evm-portal-mock-stream.js'

const ERC20_ABI = [
  {
    type: 'event' as const,
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event' as const,
    name: 'Approval',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as const
const ALICE = '0x7a250d5630b4cf539739df2c5dacb4c659f2488d' as const
const BOB = '0xc82e11e709deb68f3631fc165ebd8b4e3fc3d18f' as const

describe('test-evm-data helpers', () => {
  let mockPortal: MockPortal

  beforeEach(() => {
    resetMockBlockCounter()
  })

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  describe('encodeEvent', () => {
    it('should encode an ERC20 Transfer event', () => {
      const log = encodeEvent({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        address: WETH_ADDRESS,
        args: { from: ALICE, to: BOB, value: 100n },
      })

      expect(log.address).toBe(WETH_ADDRESS)
      expect(log.topics).toHaveLength(3)
      // topic0 = Transfer signature
      expect(log.topics[0]).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')
      // topic1 = from (padded to 32 bytes)
      expect(log.topics[1]).toBe('0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d')
      // topic2 = to (padded to 32 bytes)
      expect(log.topics[2]).toBe('0x000000000000000000000000c82e11e709deb68f3631fc165ebd8b4e3fc3d18f')
      // data = value (uint256)
      expect(log.data).toBe('0x0000000000000000000000000000000000000000000000000000000000000064')
    })

    it('should infer args types from ABI', () => {
      // Type-level test: args should include from, to, AND value
      type Args = Parameters<typeof encodeEvent<typeof ERC20_ABI, 'Transfer'>>[0]['args']
      expectTypeOf<Args>().toEqualTypeOf<{ from: `0x${string}`; to: `0x${string}`; value: bigint } | undefined>()
    })
  })

  describe('mockBlock', () => {
    it('should auto-generate block metadata', () => {
      const block = mockBlock()

      expect(block.header.number).toBe(1)
      expect(block.header.timestamp).toBe(1000)
      expect(block.header.hash).toMatch(/^0x/)
      expect(block.header.parentHash).toMatch(/^0x/)
      expect(block.transactions).toEqual([])
      expect(block.logs).toEqual([])
    })

    it('should auto-increment block numbers', () => {
      const b1 = mockBlock()
      const b2 = mockBlock()
      const b3 = mockBlock()

      expect(b1.header.number).toBe(1)
      expect(b2.header.number).toBe(2)
      expect(b3.header.number).toBe(3)
    })

    it('should allow overriding metadata', () => {
      const block = mockBlock({
        number: 42,
        timestamp: 9999,
        hash: '0xabc',
      })

      expect(block.header.number).toBe(42)
      expect(block.header.timestamp).toBe(9999)
      expect(block.header.hash).toBe('0xabc')
    })

    it('should create transactions and logs from events', () => {
      const event1 = encodeEvent({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        address: WETH_ADDRESS,
        args: { from: ALICE, to: BOB, value: 100n },
      })

      const event2 = encodeEvent({
        abi: ERC20_ABI,
        eventName: 'Approval',
        address: WETH_ADDRESS,
        args: { owner: ALICE, spender: BOB, value: 200n },
      })

      const block = mockBlock({
        transactions: [{ logs: [event1, event2] }, { logs: [event1] }],
      })

      expect(block.transactions).toHaveLength(2)
      expect(block.logs).toHaveLength(3)

      // First tx has 2 logs
      expect(block.logs[0].transactionIndex).toBe(0)
      expect(block.logs[1].transactionIndex).toBe(0)
      // Second tx has 1 log
      expect(block.logs[2].transactionIndex).toBe(1)

      // Log indices are sequential across the block
      expect(block.logs[0].logIndex).toBe(0)
      expect(block.logs[1].logIndex).toBe(1)
      expect(block.logs[2].logIndex).toBe(2)

      // Transaction hashes are auto-generated and match
      expect(block.logs[0].transactionHash).toBe(block.transactions[0].hash)
      expect(block.logs[2].transactionHash).toBe(block.transactions[1].hash)
    })
  })

  describe('evmPortalMockStream', () => {
    it('should work end-to-end with evmDecoder', async () => {
      const transfer = encodeEvent({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        address: WETH_ADDRESS,
        args: { from: ALICE, to: BOB, value: 100n },
      })

      mockPortal = await evmPortalMockStream({
        blocks: [
          mockBlock({ transactions: [{ logs: [transfer] }] }),
          mockBlock({ transactions: [{ logs: [transfer] }] }),
        ],
      })

      const stream = evmPortalSource({
        portal: mockPortal.url,
        outputs: evmDecoder({
          range: { from: 0, to: 2 },
          events: {
            transfers: commonAbis.erc20.events.Transfer,
          },
        }),
      }).pipe((e) => e.transfers)

      const res = await readAll(stream)

      expect(res).toHaveLength(2)
      expect(res[0].event.from).toBe(ALICE)
      expect(res[0].event.to).toBe(BOB)
      expect(res[0].event.value).toBe(100n)
      expect(res[0].contract).toBe(WETH_ADDRESS)
      expect(res[1].event.from).toBe(ALICE)
    })

    it('should work with multiple events per block', async () => {
      const transfer1 = encodeEvent({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        address: WETH_ADDRESS,
        args: { from: ALICE, to: BOB, value: 100n },
      })

      const transfer2 = encodeEvent({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        address: WETH_ADDRESS,
        args: { from: BOB, to: ALICE, value: 50n },
      })

      mockPortal = await evmPortalMockStream({
        blocks: [
          mockBlock({
            transactions: [{ logs: [transfer1, transfer2] }],
          }),
        ],
      })

      const stream = evmPortalSource({
        portal: mockPortal.url,
        outputs: evmDecoder({
          range: { from: 0, to: 1 },
          events: {
            transfers: commonAbis.erc20.events.Transfer,
          },
        }),
      }).pipe((e) => e.transfers)

      const res = await readAll(stream)

      expect(res).toHaveLength(2)
      expect(res[0].event.value).toBe(100n)
      expect(res[1].event.value).toBe(50n)
    })

    it('should work with mixed event types', async () => {
      const transfer = encodeEvent({
        abi: ERC20_ABI,
        eventName: 'Transfer',
        address: WETH_ADDRESS,
        args: { from: ALICE, to: BOB, value: 100n },
      })

      const approval = encodeEvent({
        abi: ERC20_ABI,
        eventName: 'Approval',
        address: WETH_ADDRESS,
        args: { owner: ALICE, spender: BOB, value: 200n },
      })

      mockPortal = await evmPortalMockStream({
        blocks: [
          mockBlock({
            transactions: [{ logs: [transfer, approval] }],
          }),
        ],
      })

      const stream = evmPortalSource({
        portal: mockPortal.url,
        outputs: evmDecoder({
          range: { from: 0, to: 1 },
          events: {
            transfers: commonAbis.erc20.events.Transfer,
            approvals: commonAbis.erc20.events.Approval,
          },
        }),
      })

      const res: { transfers: any[]; approvals: any[] }[] = []
      for await (const batch of stream) {
        res.push(batch.data)
      }

      expect(res[0].transfers).toHaveLength(1)
      expect(res[0].approvals).toHaveLength(1)
    })
  })

  describe('factory events (Uniswap V3 style)', () => {
    // Viem ABIs for encoding
    const POOL_CREATED_ABI = [
      {
        type: 'event' as const,
        name: 'PoolCreated',
        inputs: [
          { name: 'token0', type: 'address', indexed: true },
          { name: 'token1', type: 'address', indexed: true },
          { name: 'fee', type: 'uint24', indexed: true },
          { name: 'tickSpacing', type: 'int24', indexed: false },
          { name: 'pool', type: 'address', indexed: false },
        ],
      },
    ] as const

    const SWAP_ABI = [
      {
        type: 'event' as const,
        name: 'Swap',
        inputs: [
          { name: 'sender', type: 'address', indexed: true },
          { name: 'recipient', type: 'address', indexed: true },
          { name: 'amount0', type: 'int256', indexed: false },
          { name: 'amount1', type: 'int256', indexed: false },
          { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
          { name: 'liquidity', type: 'uint128', indexed: false },
          { name: 'tick', type: 'int24', indexed: false },
        ],
      },
    ] as const

    // @subsquid/evm-abi definitions for decoding
    const poolCreatedEvent = event(
      '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
      'PoolCreated(address,address,uint24,int24,address)',
      {
        token0: indexed(p.address),
        token1: indexed(p.address),
        fee: indexed(p.uint24),
        tickSpacing: p.int24,
        pool: p.address,
      },
    )

    const swapEvent = event(
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

    const UNISWAP_FACTORY = '0x1f98431c8ad98523631ae4a59f267346ea31f984' as const
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const
    const POOL_ADDRESS = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8' as const
    const ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564' as const

    it('should decode swap events from factory-created pools', async () => {
      const poolCreated = encodeEvent({
        abi: POOL_CREATED_ABI,
        eventName: 'PoolCreated',
        address: UNISWAP_FACTORY,
        args: {
          token0: WETH_ADDRESS,
          token1: USDC,
          fee: 3000,
          tickSpacing: 60,
          pool: POOL_ADDRESS,
        },
      })

      const swap = encodeEvent({
        abi: SWAP_ABI,
        eventName: 'Swap',
        address: POOL_ADDRESS,
        args: {
          sender: ROUTER,
          recipient: ALICE,
          amount0: -1000000000000000000n,
          amount1: 2000000000n,
          sqrtPriceX96: 1234567890123456789n,
          liquidity: 5000000000000n,
          tick: 200000,
        },
      })

      mockPortal = await evmPortalMockStream({
        blocks: [
          mockBlock({ transactions: [{ logs: [poolCreated] }] }),
          mockBlock({ transactions: [{ logs: [swap] }] }),
        ],
      })

      const stream = evmPortalSource({
        portal: mockPortal.url,
        outputs: evmDecoder({
          range: { from: 0, to: 2 },
          contracts: factory({
            address: UNISWAP_FACTORY,
            event: poolCreatedEvent,
            parameter: 'pool',
            database: factorySqliteDatabase({ path: ':memory:' }),
          }),
          events: {
            swaps: swapEvent,
          },
        }).pipe((d) => d.swaps),
      })

      const res = await readAll(stream)

      expect(res).toHaveLength(1)
      expect(res[0].contract).toBe(POOL_ADDRESS)
      expect(res[0].event.sender).toBe(ROUTER)
      expect(res[0].event.recipient).toBe(ALICE)
      expect(res[0].event.amount0).toBe(-1000000000000000000n)
      expect(res[0].event.amount1).toBe(2000000000n)
      expect(res[0].event.sqrtPriceX96).toBe(1234567890123456789n)
      expect(res[0].event.liquidity).toBe(5000000000000n)
      expect(res[0].event.tick).toBe(200000)

      // Factory metadata is attached
      expect(res[0].factory).toBeDefined()
      expect(res[0].factory!.contract).toBe(UNISWAP_FACTORY)
      expect(res[0].factory!.event.token0).toBe(WETH_ADDRESS)
      expect(res[0].factory!.event.token1).toBe(USDC)
      expect(res[0].factory!.event.pool).toBe(POOL_ADDRESS)
    })

    it('should ignore swaps from unknown pools', async () => {
      const UNKNOWN_POOL = '0x0000000000000000000000000000000000099999' as const

      const poolCreated = encodeEvent({
        abi: POOL_CREATED_ABI,
        eventName: 'PoolCreated',
        address: UNISWAP_FACTORY,
        args: {
          token0: WETH_ADDRESS,
          token1: USDC,
          fee: 3000,
          tickSpacing: 60,
          pool: POOL_ADDRESS,
        },
      })

      const knownSwap = encodeEvent({
        abi: SWAP_ABI,
        eventName: 'Swap',
        address: POOL_ADDRESS,
        args: {
          sender: ROUTER,
          recipient: ALICE,
          amount0: 100n,
          amount1: -200n,
          sqrtPriceX96: 1n,
          liquidity: 1n,
          tick: 0,
        },
      })

      const unknownSwap = encodeEvent({
        abi: SWAP_ABI,
        eventName: 'Swap',
        address: UNKNOWN_POOL,
        args: {
          sender: ROUTER,
          recipient: BOB,
          amount0: 999n,
          amount1: -999n,
          sqrtPriceX96: 1n,
          liquidity: 1n,
          tick: 0,
        },
      })

      mockPortal = await evmPortalMockStream({
        blocks: [
          mockBlock({ transactions: [{ logs: [poolCreated] }] }),
          mockBlock({ transactions: [{ logs: [knownSwap, unknownSwap] }] }),
        ],
      })

      const stream = evmPortalSource({
        portal: mockPortal.url,
        outputs: evmDecoder({
          range: { from: 0, to: 2 },
          contracts: factory({
            address: UNISWAP_FACTORY,
            event: poolCreatedEvent,
            parameter: 'pool',
            database: factorySqliteDatabase({ path: ':memory:' }),
          }),
          events: {
            swaps: swapEvent,
          },
        }).pipe((d) => d.swaps),
      })

      const res = await readAll(stream)

      expect(res).toHaveLength(1)
      expect(res[0].contract).toBe(POOL_ADDRESS)
      expect(res[0].event.amount0).toBe(100n)
    })

    it('should handle multiple pools from the same factory', async () => {
      const POOL_2 = '0x0000000000000000000000000000000000088888' as const
      const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7' as const

      const pool1Created = encodeEvent({
        abi: POOL_CREATED_ABI,
        eventName: 'PoolCreated',
        address: UNISWAP_FACTORY,
        args: { token0: WETH_ADDRESS, token1: USDC, fee: 3000, tickSpacing: 60, pool: POOL_ADDRESS },
      })

      const pool2Created = encodeEvent({
        abi: POOL_CREATED_ABI,
        eventName: 'PoolCreated',
        address: UNISWAP_FACTORY,
        args: { token0: WETH_ADDRESS, token1: USDT, fee: 500, tickSpacing: 10, pool: POOL_2 },
      })

      const swap1 = encodeEvent({
        abi: SWAP_ABI,
        eventName: 'Swap',
        address: POOL_ADDRESS,
        args: {
          sender: ROUTER,
          recipient: ALICE,
          amount0: 100n,
          amount1: -200n,
          sqrtPriceX96: 1n,
          liquidity: 1n,
          tick: 0,
        },
      })

      const swap2 = encodeEvent({
        abi: SWAP_ABI,
        eventName: 'Swap',
        address: POOL_2,
        args: {
          sender: ROUTER,
          recipient: BOB,
          amount0: 300n,
          amount1: -400n,
          sqrtPriceX96: 2n,
          liquidity: 2n,
          tick: 1,
        },
      })

      mockPortal = await evmPortalMockStream({
        blocks: [
          mockBlock({ transactions: [{ logs: [pool1Created, pool2Created] }] }),
          mockBlock({ transactions: [{ logs: [swap1, swap2] }] }),
        ],
      })

      const stream = evmPortalSource({
        portal: mockPortal.url,
        outputs: evmDecoder({
          range: { from: 0, to: 2 },
          contracts: factory({
            address: UNISWAP_FACTORY,
            event: poolCreatedEvent,
            parameter: 'pool',
            database: factorySqliteDatabase({ path: ':memory:' }),
          }),
          events: {
            swaps: swapEvent,
          },
        }).pipe((d) => d.swaps),
      })

      const res = await readAll(stream)

      expect(res).toHaveLength(2)
      expect(res[0].contract).toBe(POOL_ADDRESS)
      expect(res[0].factory!.event.token1).toBe(USDC)
      expect(res[1].contract).toBe(POOL_2)
      expect(res[1].factory!.event.token1).toBe(USDT)
    })
  })
})
