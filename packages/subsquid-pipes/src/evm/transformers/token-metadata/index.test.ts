import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'

import { PortalSource } from '~/core/portal-source.js'
import { EvmQueryBuilder, evmDecoder, evmPortalSource } from '~/evm/index.js'
import { MockPortal, MockResponse, closeMockPortal, createMockPortal, readAll } from '~/tests/index.js'

import { SqliteTokenStore, tokenInfo, unknownToken, WithMetadata } from './index.js'

const erc20Transfer = event(
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  'Transfer(address,address,uint256)',
  {
    from: indexed(p.address),
    to: indexed(p.address),
    value: p.uint256,
  },
)

const TRANSFER_MOCK_RESPONSE: MockResponse[] = [
  {
    statusCode: 200,
    data: [
      {
        header: { number: 1, hash: '0x1', timestamp: 2000 },
        logs: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d',
              '0x000000000000000000000000c82e11e709deb68f3631fc165ebd8b4e3fc3d18f',
            ],
            logIndex: 0,
            transactionIndex: 0,
            transactionHash: '0xdeadbeef',
            data: '0x000000000000000000000000000000000000000000000000013737bc62530000',
          },
        ],
      },
    ],
  },
]

describe('TokenInfo transformer', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    if (mockPortal) {
      await closeMockPortal(mockPortal)
      mockPortal = undefined!
    }
  })

  describe('pipeline integration', () => {
    it('should enrich decoded ERC20 transfers with token info', async () => {
      mockPortal = await createMockPortal(TRANSFER_MOCK_RESPONSE)

      const store = await SqliteTokenStore.create({ path: ':memory:' })
      await store.save([
        {
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          decimals: 18,
          symbol: 'WETH',
          name: 'Wrapped Ether',
        },
      ])

      const tokens = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
      })

      const results = await readAll(
        evmPortalSource({ portal: mockPortal.url })
          .pipe(
            evmDecoder({
              range: { from: 0, to: 1 },
              events: { transfers: erc20Transfer },
            }),
          )
          .pipe((decoded) => decoded.transfers)
          .pipe(tokens.enrich('contract')),
      )

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        contract: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        contractMetadata: {
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          decimals: 18,
          symbol: 'WETH',
          name: 'Wrapped Ether',
        },
      })
    })

    it('should enrich multiple address fields', async () => {
      mockPortal = await createMockPortal(TRANSFER_MOCK_RESPONSE)

      const store = await SqliteTokenStore.create({ path: ':memory:' })
      await store.save([
        { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18, symbol: 'WETH', name: 'Wrapped Ether' },
        { address: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', decimals: 18, symbol: 'UNI-V2', name: 'Uniswap V2' },
      ])

      const tokens = tokenInfo({ store, rpc: 'http://localhost:8545' })

      const results = await readAll(
        evmPortalSource({ portal: mockPortal.url })
          .pipe(
            evmDecoder({
              range: { from: 0, to: 1 },
              events: { transfers: erc20Transfer },
            }),
          )
          .pipe((decoded) =>
            decoded.transfers.map((t) => ({
              token: t.contract,
              sender: t.event.from,
              amount: t.event.value,
            })),
          )
          .pipe(tokens.enrich(['token', 'sender'])),
      )

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        tokenMetadata: { symbol: 'WETH', decimals: 18 },
        sender: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
        senderMetadata: { symbol: 'UNI-V2', decimals: 18 },
      })
    })
  })

  describe('get()', () => {
    it('should fetch token info from store', async () => {
      const store = await SqliteTokenStore.create({ path: ':memory:' })
      await store.save([
        { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, symbol: 'USDC', name: 'USD Coin' },
      ])

      const tokens = tokenInfo({ store, rpc: 'http://localhost:8545' })

      const result = await tokens.get(['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'])

      expect(result.get('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toEqual({
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
      })
    })

    it('should return native ETH without store lookup', async () => {
      const tokens = tokenInfo({ rpc: 'http://localhost:8545' })

      const result = await tokens.get(['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'])

      expect(result.get('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).toEqual({
        address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        decimals: 18,
        symbol: 'ETH',
        name: 'Ether',
      })
    })

    it('should handle multiple tokens in batch', async () => {
      const store = await SqliteTokenStore.create({ path: ':memory:' })
      await store.save([
        { address: '0x1111111111111111111111111111111111111111', decimals: 18, symbol: 'TK1', name: 'Token One' },
        { address: '0x2222222222222222222222222222222222222222', decimals: 6, symbol: 'TK2', name: 'Token Two' },
      ])

      const tokens = tokenInfo({ store, rpc: 'http://localhost:8545' })

      const result = await tokens.get([
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
      ])

      expect(result.size).toBe(2)
      expect(result.get('0x1111111111111111111111111111111111111111')?.symbol).toBe('TK1')
      expect(result.get('0x2222222222222222222222222222222222222222')?.symbol).toBe('TK2')
    })
  })

  describe('in-memory mode (no store)', () => {
    it('should work without persistent store', async () => {
      const tokens = tokenInfo({ rpc: 'http://localhost:8545' })

      const result = await tokens.get(['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'])

      expect(result.get('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')?.symbol).toBe('ETH')
    })
  })

  describe('error handling', () => {
    it('should throw when no RPC endpoints provided', () => {
      expect(() => tokenInfo({ rpc: [] })).toThrow('TokenInfo requires at least one RPC endpoint')
    })
  })
})

describe('unknownToken', () => {
  it('should create placeholder for unresolved addresses', () => {
    const result = unknownToken('0x1234567890123456789012345678901234567890')

    expect(result).toEqual({
      address: '0x1234567890123456789012345678901234567890',
      symbol: 'UNKNOWN',
      name: 'Unknown Token',
      decimals: 18,
    })
  })
})

describe('TokenInfo transfomer types', () => {
  const tokens = tokenInfo({ rpc: 'http://localhost:8545' })

  it('should preserve initial type when used in as input of a transformer', async () => {
    type PortalResult<Out> = PortalSource<EvmQueryBuilder<any>, Out[]>

    const mockPortal = await createMockPortal(TRANSFER_MOCK_RESPONSE)
    const firstPipe = evmPortalSource({ portal: mockPortal.url })
      .pipe(
        evmDecoder({
          range: { from: 0, to: 1 },
          events: { transfers: erc20Transfer },
        }),
      )
      .pipe((decoded) =>
        decoded.transfers.map((t) => ({
          ...t.event,
          contract: t.contract,
        })),
      )
    const secondPipe = firstPipe.pipe(tokens.enrich('contract'))

    // .pipe(s => s.map(x => x.))

    expectTypeOf<typeof firstPipe>().toEqualTypeOf<
      PortalResult<{
        from: string
        to: string
        value: bigint
        contract: string
      }>
    >()

    /**
     * The enrich function returns a type that doesn't include any of the
     * previous values of the interface, only contract and contractMetadata
     */
    expectTypeOf<typeof secondPipe>().toEqualTypeOf<
      PortalResult<
        WithMetadata<
          {
            from: string
            to: string
            value: bigint
            contract: string
          },
          'contract'
        >
      >
    >()
  })
})
