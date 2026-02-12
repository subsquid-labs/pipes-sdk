import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { afterEach, describe, expect, it } from 'vitest'

import { createTestLogger } from '~/tests/test-logger.js'
import { closeMockPortal, createMockPortal, MockPortal, MockResponse, readAll } from '~/tests/index.js'
import { evmDecoder, evmPortalSource } from '~/evm/index.js'

import { tokenInfo } from '../index.js'
import { SqliteTokenStore } from './sqlite.js'

const erc20Transfer = event(
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  'Transfer(address,address,uint256)',
  {
    from: indexed(p.address),
    to: indexed(p.address),
    value: p.uint256,
  },
)

describe('tokenInfo with SqliteTokenStore', () => {
  let mockPortal: MockPortal

  const TRANSFER_RESPONSE: MockResponse[] = [
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

  afterEach(async () => {
    if (mockPortal) {
      await closeMockPortal(mockPortal)
      mockPortal = undefined!
    }
  })

  describe('persistence', () => {
    it('should persist tokens to SQLite and retrieve on subsequent calls', async () => {
      const store = await SqliteTokenStore.create({ path: ':memory:' })
      const logger = createTestLogger()

      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
        logger,
      })

      // Manually save token to store (simulating previous RPC fetch)
      await store.save([
        {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        },
      ])

      // Service should retrieve from store without RPC call
      const result = await service.get(['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'])

      expect(result.get('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toEqual({
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
      })
    })

    it('should handle address case normalization', async () => {
      const store = await SqliteTokenStore.create({ path: ':memory:' })

      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
      })

      // Save with lowercase
      await store.save([
        {
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        },
      ])

      // Query with mixed case
      const result = await service.get(['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'])

      expect(result.size).toBe(1)
      expect(result.get('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')?.symbol).toBe('USDC')
    })
  })

  describe('enrich with pipeline', () => {
    it('should enrich decoded events with token info from SQLite store', async () => {
      mockPortal = await createMockPortal(TRANSFER_RESPONSE)

      const store = await SqliteTokenStore.create({ path: ':memory:' })

      // Pre-populate store
      await store.save([
        {
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          decimals: 18,
          symbol: 'WETH',
          name: 'Wrapped Ether',
        },
      ])

      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
      })

      const stream = evmPortalSource({ portal: mockPortal.url })
        .pipe(
          evmDecoder({
            range: { from: 0, to: 1 },
            events: {
              transfers: erc20Transfer,
            },
          }),
        )
        .pipe((decoded) => decoded.transfers)
        .pipe(service.enrich('contract'))

      const results = await readAll(stream)

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
  })

  describe('native token handling', () => {
    it('should return native ETH token without store lookup', async () => {
      const store = await SqliteTokenStore.create({ path: ':memory:' })

      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
      })

      const result = await service.get(['0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'])

      expect(result.get('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).toEqual({
        address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        decimals: 18,
        symbol: 'ETH',
        name: 'Ether',
      })
    })
  })

  describe('batch operations', () => {
    it('should handle multiple tokens in single get call', async () => {
      const store = await SqliteTokenStore.create({ path: ':memory:' })

      await store.save([
        { address: '0x1111111111111111111111111111111111111111', decimals: 18, symbol: 'TK1', name: 'Token One' },
        { address: '0x2222222222222222222222222222222222222222', decimals: 6, symbol: 'TK2', name: 'Token Two' },
        { address: '0x3333333333333333333333333333333333333333', decimals: 8, symbol: 'TK3', name: 'Token Three' },
      ])

      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
      })

      const result = await service.get([
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
        '0x3333333333333333333333333333333333333333',
      ])

      expect(result.size).toBe(3)
      expect(result.get('0x1111111111111111111111111111111111111111')?.symbol).toBe('TK1')
      expect(result.get('0x2222222222222222222222222222222222222222')?.symbol).toBe('TK2')
      expect(result.get('0x3333333333333333333333333333333333333333')?.symbol).toBe('TK3')
    })

    it('should deduplicate addresses in get call', async () => {
      const store = await SqliteTokenStore.create({ path: ':memory:' })

      await store.save([
        { address: '0x1111111111111111111111111111111111111111', decimals: 18, symbol: 'TK1', name: 'Token One' },
      ])

      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
      })

      // Same address repeated with different casing
      const result = await service.get([
        '0x1111111111111111111111111111111111111111',
        '0x1111111111111111111111111111111111111111',
        '0x1111111111111111111111111111111111111111',
      ])

      expect(result.size).toBe(1)
    })
  })

  describe('SqliteTokenStore.create', () => {
    it('should create store with migrations applied', async () => {
      const store = await SqliteTokenStore.create({ path: ':memory:' })

      // Should work immediately without manual migrate()
      await store.save([
        { address: '0x1234567890123456789012345678901234567890', decimals: 18, symbol: 'TEST', name: 'Test' },
      ])

      const result = await store.get(['0x1234567890123456789012345678901234567890'])
      expect(result['0x1234567890123456789012345678901234567890']?.symbol).toBe('TEST')
    })
  })
})
