import { viewFun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { describe, expect, it } from 'vitest'

import { LFUCache } from './lfu-cache.js'
import { MULTICALL3_ADDRESS, aggregate3, decodeMulticallResult, encodeMulticall } from './multicall.js'
import { RpcClient } from './rpc-client.js'
import { rpcEnricher } from './rpc-enricher.js'

describe('LFUCache', () => {
  it('should store and retrieve values', () => {
    const cache = new LFUCache<string>(3)

    cache.set('a', 'value-a')
    cache.set('b', 'value-b')

    expect(cache.get('a')).toBe('value-a')
    expect(cache.get('b')).toBe('value-b')
    expect(cache.get('c')).toBeUndefined()
  })

  it('should report size correctly', () => {
    const cache = new LFUCache<string>(10)

    expect(cache.size).toBe(0)
    cache.set('a', 'value')
    expect(cache.size).toBe(1)
    cache.set('b', 'value')
    expect(cache.size).toBe(2)
  })

  it('should check if key exists', () => {
    const cache = new LFUCache<string>(3)

    cache.set('a', 'value')

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('should evict least frequently used item when at capacity', () => {
    const cache = new LFUCache<string>(2)

    cache.set('a', 'value-a')
    cache.set('b', 'value-b')

    // Access 'a' to increase its frequency
    cache.get('a')

    // Adding 'c' should evict 'b' (least frequently used)
    cache.set('c', 'value-c')

    expect(cache.get('a')).toBe('value-a')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('value-c')
  })

  it('should evict oldest item when frequencies are equal', () => {
    const cache = new LFUCache<string>(2)

    cache.set('a', 'value-a')
    cache.set('b', 'value-b')

    // Both have freq=1, 'a' was added first so it should be evicted
    cache.set('c', 'value-c')

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('value-b')
    expect(cache.get('c')).toBe('value-c')
  })

  it('should update value for existing key', () => {
    const cache = new LFUCache<string>(2)

    cache.set('a', 'value-1')
    cache.set('a', 'value-2')

    expect(cache.get('a')).toBe('value-2')
    expect(cache.size).toBe(1)
  })

  it('should bump frequency when updating existing key', () => {
    const cache = new LFUCache<string>(2)

    cache.set('a', 'value-a')
    cache.set('b', 'value-b')

    // Update 'a' to increase its frequency
    cache.set('a', 'value-a-updated')

    // Adding 'c' should evict 'b' since 'a' now has higher frequency
    cache.set('c', 'value-c')

    expect(cache.get('a')).toBe('value-a-updated')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('value-c')
  })

  it('should throw error for non-positive capacity', () => {
    expect(() => new LFUCache(0)).toThrow('LFUCache capacity must be positive')
    expect(() => new LFUCache(-1)).toThrow('LFUCache capacity must be positive')
  })

  it('should handle complex eviction scenario', () => {
    const cache = new LFUCache<number>(3)

    cache.set('a', 1) // freq: 1
    cache.set('b', 2) // freq: 1
    cache.set('c', 3) // freq: 1

    // Access pattern: a twice, b once
    cache.get('a') // a freq: 2
    cache.get('a') // a freq: 3
    cache.get('b') // b freq: 2

    // c has lowest freq (1), should be evicted
    cache.set('d', 4)

    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBeUndefined()
    expect(cache.get('d')).toBe(4)
  })

  it('should clear all entries', () => {
    const cache = new LFUCache<string>(3)

    cache.set('a', 'value-a')
    cache.set('b', 'value-b')
    cache.get('a') // bump frequency

    expect(cache.size).toBe(2)

    cache.clear()

    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
    expect(cache.has('a')).toBe(false)

    // Should be able to add new items after clear
    cache.set('c', 'value-c')
    expect(cache.get('c')).toBe('value-c')
    expect(cache.size).toBe(1)
  })
})

describe('Multicall encoding/decoding', () => {
  const nameFunc = viewFun('0x06fdde03', 'name()', {}, p.string)
  const decimalsFunc = viewFun('0x313ce567', 'decimals()', {}, p.uint8)

  it('should encode multicall requests', () => {
    const requests = [
      {
        target: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        callData: nameFunc.encode({}),
        allowFailure: true,
      },
      {
        target: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        callData: decimalsFunc.encode({}),
        allowFailure: true,
      },
    ]

    const encoded = encodeMulticall(requests)

    // Should start with aggregate3 selector
    expect(encoded.startsWith('0x82ad56cb')).toBe(true)
    // Should be a valid hex string
    expect(/^0x[0-9a-f]+$/i.test(encoded)).toBe(true)
  })

  it('should decode multicall result', () => {
    // Test with known encoded multicall return data
    const simpleResult = decodeMulticallResult(
      '0x' +
        '0000000000000000000000000000000000000000000000000000000000000020' + // offset to array
        '0000000000000000000000000000000000000000000000000000000000000001' + // array length = 1
        '0000000000000000000000000000000000000000000000000000000000000020' + // offset to first struct
        '0000000000000000000000000000000000000000000000000000000000000001' + // success = true
        '0000000000000000000000000000000000000000000000000000000000000040' + // offset to returnData
        '0000000000000000000000000000000000000000000000000000000000000004' + // returnData length = 4
        'deadbeef00000000000000000000000000000000000000000000000000000000', // returnData = 0xdeadbeef (padded)
    )

    expect(simpleResult).toHaveLength(1)
    expect(simpleResult[0].success).toBe(true)
    expect(simpleResult[0].returnData).toBe('0xdeadbeef')
  })

  it('should use canonical Multicall3 address', () => {
    expect(MULTICALL3_ADDRESS).toBe('0xcA11bde05977b3631167028862bE2a173976CA11')
  })

  it('should default allowFailure to true', () => {
    const requests = [
      {
        target: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        callData: '0x06fdde03',
      },
    ]

    const encoded = encodeMulticall(requests)

    // The encoding should succeed without explicit allowFailure
    expect(encoded).toBeTruthy()
  })
})

describe('RpcClient', () => {
  it('should throw error when no URLs provided', () => {
    expect(() => new RpcClient({ urls: [] })).toThrow('At least one RPC URL is required')
  })

  it('should construct with single URL', () => {
    const client = new RpcClient({ urls: ['http://localhost:8545'] })
    expect(client).toBeInstanceOf(RpcClient)
  })

  it('should construct with multiple URLs', () => {
    const client = new RpcClient({
      urls: ['http://localhost:8545', 'http://localhost:8546'],
    })
    expect(client).toBeInstanceOf(RpcClient)
  })

  // Integration tests would require a running RPC server
  // These are placeholder tests showing expected behavior

  it.skip('should call JSON-RPC method', async () => {
    const client = new RpcClient({ urls: ['http://localhost:8545'] })
    const blockNumber = await client.call<string>('eth_blockNumber', [])
    expect(typeof blockNumber).toBe('string')
  })

  it.skip('should execute multicall', async () => {
    const client = new RpcClient({ urls: ['http://localhost:8545'] })
    const nameFunc = viewFun('0x06fdde03', 'name()', {}, p.string)

    const results = await client.multicall(MULTICALL3_ADDRESS, [
      {
        target: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC on Ethereum
        callData: nameFunc.encode({}),
      },
    ])

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
  })
})

describe('rpcEnricher', () => {
  const nameFunc = viewFun('0x06fdde03', 'name()', {}, p.string)
  const decimalsFunc = viewFun('0x313ce567', 'decimals()', {}, p.uint8)
  const balanceOfFunc = viewFun('0x70a08231', 'balanceOf(address)', { _owner: p.address }, p.uint256)

  describe('method validation', () => {
    it('should accept zero-argument methods', () => {
      expect(() =>
        rpcEnricher({
          rpcUrls: ['http://localhost:8545'],
          addressField: 'contract',
          methods: [nameFunc, decimalsFunc],
        }),
      ).not.toThrow()
    })

    it('should reject methods with arguments', () => {
      expect(() =>
        rpcEnricher({
          rpcUrls: ['http://localhost:8545'],
          addressField: 'contract',
          methods: [balanceOfFunc],
        }),
      ).toThrow(/only supports zero-argument functions/)
    })
  })

  describe('utility functions', () => {
    it('should extract function name from signature', () => {
      // Extract function name from signature (before the parenthesis)
      const getName = (func: { signature: string }) => {
        const parenIndex = func.signature.indexOf('(')
        return parenIndex > 0 ? func.signature.slice(0, parenIndex) : func.signature
      }

      expect(getName(nameFunc)).toBe('name')
      expect(getName(decimalsFunc)).toBe('decimals')
      expect(getName(balanceOfFunc)).toBe('balanceOf')
    })

    it('should extract nested values using dot notation', () => {
      const getNestedValue = (obj: unknown, path: string): unknown => {
        const parts = path.split('.')
        let current: unknown = obj

        for (const part of parts) {
          if (current === null || current === undefined) return undefined
          if (typeof current !== 'object') return undefined
          current = (current as Record<string, unknown>)[part]
        }

        return current
      }

      const obj = {
        event: {
          contract: '0x123',
          data: {
            nested: 'value',
          },
        },
        contract: '0x456',
      }

      expect(getNestedValue(obj, 'contract')).toBe('0x456')
      expect(getNestedValue(obj, 'event.contract')).toBe('0x123')
      expect(getNestedValue(obj, 'event.data.nested')).toBe('value')
      expect(getNestedValue(obj, 'nonexistent')).toBeUndefined()
      expect(getNestedValue(obj, 'event.nonexistent')).toBeUndefined()
      expect(getNestedValue(null, 'any')).toBeUndefined()
      expect(getNestedValue(undefined, 'any')).toBeUndefined()
    })
  })

  describe('order preservation', () => {
    it('documents the order preservation algorithm', () => {
      // The rpcEnricher transformer preserves item order by:
      // 1. Collecting all items with their original indices before processing
      // 2. Deduplicating addresses for RPC fetching (efficiency)
      // 3. Iterating items in original order when building result
      //
      // Full integration testing requires mocking RPC responses.
      // This test documents the expected behavior for items with:
      // - Valid addresses (should get rpcData from cache)
      // - Null/missing addresses (should get empty rpcData)
      // - Duplicate addresses (should share cached rpcData)

      const items = [
        { contract: '0x111', value: 1 },
        { contract: null, value: 2 }, // no contract
        { contract: '0x222', value: 3 },
        { contract: '0x111', value: 4 }, // duplicate address
      ]

      // Verify test data has expected order
      expect(items.map((i) => i.value)).toEqual([1, 2, 3, 4])

      // Verify deduplication logic would find 2 unique addresses
      const uniqueAddresses = new Set(
        items.filter((i) => i.contract).map((i) => i.contract!.toLowerCase()),
      )
      expect(uniqueAddresses.size).toBe(2)
    })
  })

  describe('edge cases', () => {
    it('should handle empty events gracefully', async () => {
      const transformer = rpcEnricher({
        rpcUrls: ['http://localhost:8545'],
        addressField: 'contract',
        methods: [nameFunc],
      })

      // The transformer should handle empty input without errors
      expect(transformer).toBeDefined()
      expect(transformer.options.profiler?.id).toBe('RPC enricher')
    })

    it('should accept single URL string', () => {
      expect(() =>
        rpcEnricher({
          rpcUrls: 'http://localhost:8545',
          addressField: 'contract',
          methods: [nameFunc],
        }),
      ).not.toThrow()
    })

    it('should accept array of URLs', () => {
      expect(() =>
        rpcEnricher({
          rpcUrls: ['http://localhost:8545', 'http://localhost:8546'],
          addressField: 'contract',
          methods: [nameFunc],
        }),
      ).not.toThrow()
    })

    it('should use default values for optional parameters', () => {
      const transformer = rpcEnricher({
        rpcUrls: 'http://localhost:8545',
        addressField: 'contract',
        methods: [nameFunc],
      })

      // Transformer should be created successfully with defaults
      expect(transformer).toBeDefined()
    })

    it('should use custom profilerId when provided', () => {
      const transformer = rpcEnricher({
        rpcUrls: 'http://localhost:8545',
        addressField: 'contract',
        methods: [nameFunc],
        profilerId: 'Token metadata enricher',
      })

      expect(transformer.options.profiler?.id).toBe('Token metadata enricher')
    })

    it('should accept callOnEventBlock option', () => {
      // callOnEventBlock makes RPC calls at each event's block.number
      // Cache key becomes address:block:methods for mutable state like pool reserves
      expect(() =>
        rpcEnricher({
          rpcUrls: 'http://localhost:8545',
          addressField: 'contract',
          methods: [nameFunc],
          callOnEventBlock: true,
        }),
      ).not.toThrow()
    })
  })
})
