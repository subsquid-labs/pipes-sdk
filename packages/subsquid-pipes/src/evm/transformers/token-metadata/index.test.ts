import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestLogger } from '~/tests/test-logger.js'
import { closeMockPortal, createMockPortal, MockPortal, MockResponse, readAll } from '~/tests/index.js'

import { EvmMulticallAddress } from './constants.js'
import { tokenInfo, unknownToken, TokenStore } from './index.js'
import { Token } from './types.js'
import { evmDecoder, evmPortalSource } from '~/evm/index.js'

class MockTokenStore implements TokenStore {
  private tokens = new Map<string, Token>()

  migrate() {}

  save(tokens: Token[]) {
    tokens.forEach((t) => this.tokens.set(t.address.toLowerCase(), t))
  }

  async get(addresses: string[]): Promise<Record<string, Token>> {
    const result: Record<string, Token> = {}
    addresses.forEach((addr) => {
      const token = this.tokens.get(addr.toLowerCase())
      if (token) result[addr] = token
    })
    return result
  }
}

describe('unknownToken', () => {
  it('should return unknown metadata for an address', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const metadata = unknownToken(address)

    expect(metadata).toEqual({
      symbol: 'UNKNOWN',
      name: 'Unknown Token',
      decimals: 18,
      address: address.toLowerCase(),
    })
  })
})

describe('tokenInfo', () => {
  let store: MockTokenStore
  let logger: ReturnType<typeof createTestLogger>

  beforeEach(() => {
    store = new MockTokenStore()
    logger = createTestLogger()
  })

  describe('constructor', () => {
    it('should throw error when no RPC endpoints provided', () => {
      expect(() => {
        tokenInfo({
          store,
          rpc: [],
          multicallAddress: EvmMulticallAddress,
          logger,
        })
      }).toThrow('TokenInfo requires at least one RPC endpoint')
    })

    it('should initialize with native ETH token in cache', async () => {
      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
        multicallAddress: EvmMulticallAddress,
        logger,
      })

      const nativeToken = await service.get(['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'])
      expect(nativeToken.get('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).toEqual({
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      })
    })
  })

  describe('auto-initialization', () => {
    it('should call store migrate automatically on first use', async () => {
      const migrateSpy = vi.spyOn(store, 'migrate')
      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
        multicallAddress: EvmMulticallAddress,
        logger,
      })

      // Trigger initialization by calling get()
      await service.get(['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'])

      expect(migrateSpy).toHaveBeenCalled()
    })
  })

  describe('enrich', () => {
    it('should enrich events with token metadata', async () => {
      const testTokenMetadata: Token = {
        address: '0x1234567890123456789012345678901234567890',
        decimals: 18,
        symbol: 'TEST',
        name: 'Test Token',
      }
      store.save([testTokenMetadata])

      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
        multicallAddress: EvmMulticallAddress,
        logger,
      })

      const events = [{ address: '0x1234567890123456789012345678901234567890', value: 100n }]

      const enricher = service.enrich('address')
      const result = await enricher(events)

      expect(result[0]).toMatchObject({
        address: '0x1234567890123456789012345678901234567890',
        value: 100n,
        addressMetadata: {
          decimals: 18,
          symbol: 'TEST',
          name: 'Test Token',
        },
      })
    })

    it('should use custom address key', async () => {
      const testTokenMetadata: Token = {
        address: '0x1234567890123456789012345678901234567890',
        decimals: 18,
        symbol: 'TEST',
        name: 'Test Token',
      }
      store.save([testTokenMetadata])

      const service = tokenInfo({
        store,
        rpc: 'http://localhost:8545',
        multicallAddress: EvmMulticallAddress,
        logger,
      })

      const events = [{ tokenAddr: '0x1234567890123456789012345678901234567890', value: 100n }]

      const enricher = service.enrich('tokenAddr')
      const result = await enricher(events)

      expect(result[0]).toMatchObject({
        tokenAddr: '0x1234567890123456789012345678901234567890',
        value: 100n,
        tokenAddrMetadata: {
          decimals: 18,
          symbol: 'TEST',
          name: 'Test Token',
        },
      })
    })

    it('should return undefined metadata when token not found in store and RPC fails', async () => {
      // Use a mock store that never finds tokens
      const emptyStore = new MockTokenStore()

      const service = tokenInfo({
        store: emptyStore,
        rpc: 'http://localhost:8545', // This won't connect, causing RPC to fail
        multicallAddress: EvmMulticallAddress,
        logger,
      })

      const events = [{ address: '0x9999999999999999999999999999999999999999', value: 100n }]

      const enricher = service.enrich('address')
      const result = await enricher(events)

      // Service will return event with undefined metadata when RPC fails
      expect(result[0]).toHaveProperty('address', '0x9999999999999999999999999999999999999999')
      expect(result[0]).toHaveProperty('value', 100n)
      expect(result[0]).toHaveProperty('addressMetadata')
    })
  })
})

const erc20Abi = {
  Transfer: event(
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    'Transfer(address,address,uint256)',
    {
      from: indexed(p.address),
      to: indexed(p.address),
      value: p.uint256,
    },
  ),
}

describe('e2e tests as transformer', () => {
  let mockPortal: MockPortal

  const TRANSFER_MOCK_RESPONSE: MockResponse[] = [
    {
      statusCode: 200,
      data: [
        {
          header: { number: 1, hash: '0x1', timestamp: 2000 },
          logs: [
            {
              // WETH transfer
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
    if (mockPortal) await closeMockPortal(mockPortal)
  })

  it('should enrich decoded events with token metadata using enrich()', async () => {
    mockPortal = await createMockPortal(TRANSFER_MOCK_RESPONSE)

    // Pre-populate the store with token metadata
    const store = new MockTokenStore()
    store.save([
      {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        decimals: 18,
        symbol: 'WETH',
        name: 'Wrapped Ether',
      },
    ])

    const tokenService = tokenInfo({
      store,
      rpc: 'http://localhost:8545',
    })

    const stream = evmPortalSource({
      portal: mockPortal.url,
    })
      .pipe(
        evmDecoder({
          range: { from: 0, to: 1 },
          events: {
            transfers: erc20Abi.Transfer,
          },
        }),
      )
      .pipe((decoded) => decoded.transfers)
      // Use the enrich method to add token metadata
      .pipe(tokenService.enrich('contract'))

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

  it('should enrich multiple address fields using enrich() with array of keys', async () => {
    mockPortal = await createMockPortal(TRANSFER_MOCK_RESPONSE)

    // Pre-populate the store with token metadata
    const store = new MockTokenStore()
    store.save([
      {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        decimals: 18,
        symbol: 'WETH',
        name: 'Wrapped Ether',
      },
      {
        address: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
        decimals: 18,
        symbol: 'UNI-V2',
        name: 'Uniswap V2',
      },
    ])

    const tokenService = tokenInfo({
      store,
      rpc: 'http://localhost:8545',
      multicallAddress: EvmMulticallAddress,
      logger: createTestLogger(),
    })

    const stream = evmPortalSource({
      portal: mockPortal.url,
    })
      .pipe(
        evmDecoder({
          range: { from: 0, to: 1 },
          events: {
            transfers: erc20Abi.Transfer,
          },
        }),
      )
      .pipe((decoded) =>
        decoded.transfers.map((t) => ({
          token: t.contract,
          sender: t.event.from,
          amount: t.event.value,
        })),
      )
      // Enrich both token and sender addresses with metadata
      .pipe(tokenService.enrich(['token', 'sender']))

    const results = await readAll(stream)

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      token: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tokenMetadata: {
        symbol: 'WETH',
        decimals: 18,
      },
      sender: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
      senderMetadata: {
        symbol: 'UNI-V2',
        decimals: 18,
      },
    })
  })
})
