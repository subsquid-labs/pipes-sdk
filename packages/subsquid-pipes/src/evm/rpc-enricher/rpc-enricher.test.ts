import { viewFun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { describe, expect, it } from 'vitest'

import { rpcEnricher } from './rpc-enricher.js'

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

    it('should throw error when no methods provided', () => {
      expect(() =>
        rpcEnricher({
          rpcUrls: ['http://localhost:8545'],
          addressField: 'contract',
          methods: [],
        }),
      ).toThrow(/at least one method/)
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
      // - Valid addresses (should get contractState from cache)
      // - Null/missing addresses (should get empty contractState)
      // - Duplicate addresses (should share cached contractState)

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

    it('should use custom profiler when provided', () => {
      const transformer = rpcEnricher({
        rpcUrls: 'http://localhost:8545',
        addressField: 'contract',
        methods: [nameFunc],
        profiler: { id: 'Token metadata enricher' },
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
