import { describe, expect, it } from 'vitest'

import { LFUCache } from './lfu-cache.js'

describe('LFUCache', () => {
  describe('basic operations', () => {
    it('should set and get values', () => {
      const cache = new LFUCache<string>(10)

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBe('value2')
    })

    it('should return undefined for non-existent keys', () => {
      const cache = new LFUCache<string>(10)

      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('should correctly report key existence with has()', () => {
      const cache = new LFUCache<string>(10)

      cache.set('key1', 'value1')

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('nonexistent')).toBe(false)
    })

    it('should update existing values', () => {
      const cache = new LFUCache<string>(10)

      cache.set('key1', 'value1')
      cache.set('key1', 'updated')

      expect(cache.get('key1')).toBe('updated')
    })
  })

  describe('eviction', () => {
    it('should evict least frequently used item when capacity is reached', () => {
      const cache = new LFUCache<string>(2)

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      // Access key1 to increase its frequency
      cache.get('key1')

      // Add new item, should evict key2 (lower frequency)
      cache.set('key3', 'value3')

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(true)
    })

    it('should evict items with same frequency in insertion order', () => {
      const cache = new LFUCache<string>(2)

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      // Both have frequency 1, key1 should be evicted first (oldest)
      cache.set('key3', 'value3')

      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(true)
      expect(cache.has('key3')).toBe(true)
    })

    it('should not add items when capacity is 0', () => {
      const cache = new LFUCache<string>(0)

      cache.set('key1', 'value1')

      expect(cache.has('key1')).toBe(false)
    })
  })

  describe('pinning', () => {
    it('should not evict pinned items', () => {
      const cache = new LFUCache<string>(2)

      cache.set('pinned', 'pinnedValue', true)
      cache.set('unpinned', 'unpinnedValue')

      // Add new item, should evict unpinned even though both have freq 1
      cache.set('key3', 'value3')

      expect(cache.has('pinned')).toBe(true)
      expect(cache.has('unpinned')).toBe(false)
      expect(cache.has('key3')).toBe(true)
    })

    it('should preserve pinned status when updating value', () => {
      const cache = new LFUCache<string>(2)

      cache.set('key1', 'value1', true)
      cache.set('key1', 'updated', false) // Try to unpin by passing false

      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      // key1 should still be pinned and not evicted
      expect(cache.has('key1')).toBe(true)
      expect(cache.get('key1')).toBe('updated')
    })

    it('should not evict when all items are pinned', () => {
      const cache = new LFUCache<string>(2)

      cache.set('pinned1', 'value1', true)
      cache.set('pinned2', 'value2', true)

      // Cannot evict anything, so this should not be added
      cache.set('key3', 'value3')

      expect(cache.has('pinned1')).toBe(true)
      expect(cache.has('pinned2')).toBe(true)
      expect(cache.has('key3')).toBe(false)
    })
  })

  describe('frequency tracking', () => {
    it('should increase frequency on get', () => {
      const cache = new LFUCache<string>(3)

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      // Access key1 twice, key2 once
      cache.get('key1')
      cache.get('key1')
      cache.get('key2')

      // Add new item, should evict key3 (lowest frequency = 1)
      cache.set('key4', 'value4')

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(true)
      expect(cache.has('key3')).toBe(false)
      expect(cache.has('key4')).toBe(true)
    })

    it('should increase frequency on set (update)', () => {
      const cache = new LFUCache<string>(2)

      cache.set('key1', 'value1')
      cache.set('key1', 'updated') // This should bump frequency
      cache.set('key2', 'value2')

      // Add new item, should evict key2 (lower frequency)
      cache.set('key3', 'value3')

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(true)
    })
  })
})
