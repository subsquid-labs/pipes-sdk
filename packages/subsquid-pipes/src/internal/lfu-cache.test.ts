import { describe, expect, it } from 'vitest'

import { LFUCache } from './lfu-cache.js'

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
