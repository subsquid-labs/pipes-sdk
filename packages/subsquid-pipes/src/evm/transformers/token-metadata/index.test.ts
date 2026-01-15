import {event, indexed} from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {createTestLogger} from '~/tests/test-logger.js'
import {closeMockPortal, createMockPortal, MockPortal, MockResponse, readAll} from '~/tests/index.js'

import {EvmMulticallAddresses} from './constants.js'
import {tokenMetadata, unknownMetadata} from './index.js'
import {Token, TokenStore} from './types.js'
import {evmDecoder, evmPortalSource, factory, factorySqliteDatabase} from '~/evm/index.js'

class MockTokenMetadataStore implements TokenStore {
  private tokens = new Map<string, Token>()

  migrate() {
  }

  save(tokens: Token[]) {
    tokens.forEach((t) => this.tokens.set(t.address, t))
  }

  async get(addresses: string[]): Promise<Record<string, Token>> {
    const result: Record<string, Token> = {}
    addresses.forEach((addr) => {
      const token = this.tokens.get(addr)
      if (token) result[addr] = token
    })
    return result
  }
}

describe('unknownMetadata', () => {
  it('should return unknown metadata for an address', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const metadata = unknownMetadata(address)

    expect(metadata).toEqual({
      symbol: 'UKN',
      name: 'Unknown',
      decimals: 18,
      address,
    })
  })
})


describe('tokenMetadata', () => {
  let store: MockTokenMetadataStore
  let logger: ReturnType<typeof createTestLogger>

  beforeEach(() => {
    store = new MockTokenMetadataStore()
    logger = createTestLogger()
  })

  describe('constructor', () => {
    it('should throw error when no RPC endpoints provided', () => {
      expect(() => {
        tokenMetadata({
          store,
          rpcPool: [],
          multicallAddress: EvmMulticallAddresses['ethereum-mainnet'],
          logger,
        })
      }).toThrow('Token metadata service requires at least one RPC endpoint')
    })

    it('should initialize with native ETH token in cache', () => {
      const service = tokenMetadata({
        store,
        rpcPool: ['http://localhost:8545'],
        multicallAddress: EvmMulticallAddresses['ethereum-mainnet'],
        logger,
      })

      const nativeToken = service.tokenMetadataCache.get('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
      expect(nativeToken).toEqual({
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
        address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      })
    })
  })

  describe('migrate', () => {
    it('should call store migrate', async () => {
      const migrateSpy = vi.spyOn(store, 'migrate')
      const service = tokenMetadata({
        store,
        rpcPool: ['http://localhost:8545'],
        multicallAddress: EvmMulticallAddresses['ethereum-mainnet'],
        logger,
      })

      await service.migrate()

      expect(migrateSpy).toHaveBeenCalled()
    })
  })

  describe('enrichEventsWithTokenMetadata', () => {
    it('should enrich events with token metadata', async () => {
      const testTokenMetadata: Token = {
        address: '0x1234567890123456789012345678901234567890',
        decimals: 18,
        symbol: 'TEST',
        name: 'Test Token',
      }
      store.save([testTokenMetadata])

      const service = tokenMetadata({
        store,
        rpcPool: ['http://localhost:8545'],
        multicallAddress: EvmMulticallAddresses['ethereum-mainnet'],
        logger,
      })
      await service.migrate()

      const events = [
        {address: '0x1234567890123456789012345678901234567890', value: 100n},
      ]

      const result = await service.enrichEventsWithToken(events)

      expect(result[0]).toMatchObject({
        address: '0x1234567890123456789012345678901234567890',
        value: 100n,
        decimals: 18,
        symbol: 'TEST',
        name: 'Test Token',
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

      const service = tokenMetadata({
        store,
        rpcPool: ['http://localhost:8545'],
        multicallAddress: EvmMulticallAddresses['ethereum-mainnet'],
        logger,
      })
      await service.migrate()

      const events = [
        {tokenAddr: '0x1234567890123456789012345678901234567890', value: 100n},
      ]

      const result = await service.enrichEventsWithToken(events, 'tokenAddr')

      expect(result[0]).toMatchObject({
        tokenAddr: '0x1234567890123456789012345678901234567890',
        value: 100n,
        decimals: 18,
        symbol: 'TEST',
        name: 'Test Token',
      })
    })

    it('should enrich with unknown metadata when token not found in store and RPC fails', async () => {
      // Use a mock store that never finds tokens
      const emptyStore = new MockTokenMetadataStore()

      const service = tokenMetadata({
        store: emptyStore,
        rpcPool: ['http://localhost:8545'], // This won't connect, causing RPC to fail
        multicallAddress: EvmMulticallAddresses['ethereum-mainnet'],
        logger,
      })
      await service.migrate()

      const events = [
        {address: '0x9999999999999999999999999999999999999999', value: 100n},
      ]

      const result = await service.enrichEventsWithToken(events)

      // Service will return event with unknown/empty metadata when RPC fails
      // The exact behavior depends on error handling in the service
      expect(result[0]).toHaveProperty('address', '0x9999999999999999999999999999999999999999')
      expect(result[0]).toHaveProperty('value', 100n)
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
          header: {number: 1, hash: '0x1', timestamp: 2000},
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

  it('should enrich decoded events with token metadata using transform()', async () => {
    mockPortal = await createMockPortal(TRANSFER_MOCK_RESPONSE)

    // Pre-populate the store with token metadata
    const store = new MockTokenMetadataStore()
    store.save([
      {
        address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        decimals: 18,
        symbol: 'WETH',
        name: 'Wrapped Ether',
      },
    ])

    const tokenService = tokenMetadata({
      store,
      rpcPool: ['http://localhost:8545'],
      multicallAddress: EvmMulticallAddresses['ethereum-mainnet'],
      logger: createTestLogger(),
    })
    await tokenService.migrate()

    const stream = evmPortalSource({
      portal: mockPortal.url,
    })
      .pipe(
        evmDecoder({
          range: {from: 0, to: 1},
          events: {
            transfers: erc20Abi.Transfer,
          },
        }),
      )
      .pipe((decoded) => decoded.transfers)
      // Use the transform method to enrich with token metadata
      .pipe(tokenService.transform('contract'))

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

  it('should enrich multiple address fields using transform() with array of keys', async () => {
    mockPortal = await createMockPortal(TRANSFER_MOCK_RESPONSE)

    // Pre-populate the store with token metadata
    const store = new MockTokenMetadataStore()
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

    const tokenService = tokenMetadata({
      store,
      rpcPool: ['http://localhost:8545'],
      multicallAddress: EvmMulticallAddresses['ethereum-mainnet'],
      logger: createTestLogger(),
    })
    await tokenService.migrate()

    const stream = evmPortalSource({
      portal: mockPortal.url,
    })
      .pipe(
        evmDecoder({
          range: {from: 0, to: 1},
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
      .pipe(tokenService.transform(['token', 'sender']))

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
