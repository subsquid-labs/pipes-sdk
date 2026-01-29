/**
 * LFU (Least Frequently Used) cache implementation with O(1) operations.
 *
 * Uses a combination of a hash map for O(1) lookups and frequency buckets
 * for O(1) eviction of the least frequently used item.
 *
 * **Tie-breaking behavior:** When multiple items have the same frequency,
 * the oldest item (FIFO order) is evicted first. This is based on Set
 * insertion order which is preserved in JavaScript.
 */
export class LFUCache<V> {
  private entries: Map<string, { value: V; freq: number }>
  private freqMap: Map<number, Set<string>>
  private minFreq: number
  private capacity: number

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('LFUCache capacity must be positive')
    }
    this.capacity = capacity
    this.entries = new Map()
    this.freqMap = new Map()
    this.minFreq = 0
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    this.bumpFrequency(key)
    return entry.value
  }

  set(key: string, value: V): void {
    if (this.capacity <= 0) return

    const existing = this.entries.get(key)
    if (existing) {
      existing.value = value
      this.bumpFrequency(key)
      return
    }

    this.evictIfNeeded()

    this.entries.set(key, { value, freq: 1 })

    let freqSet = this.freqMap.get(1)
    if (!freqSet) {
      freqSet = new Set()
      this.freqMap.set(1, freqSet)
    }
    freqSet.add(key)

    this.minFreq = 1
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  get size(): number {
    return this.entries.size
  }

  /**
   * Remove all entries from the cache.
   */
  clear(): void {
    this.entries.clear()
    this.freqMap.clear()
    this.minFreq = 0
  }

  private bumpFrequency(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return

    const oldFreq = entry.freq
    const newFreq = oldFreq + 1
    entry.freq = newFreq

    const oldFreqSet = this.freqMap.get(oldFreq)
    if (oldFreqSet) {
      oldFreqSet.delete(key)
      if (oldFreqSet.size === 0) {
        this.freqMap.delete(oldFreq)
        if (this.minFreq === oldFreq) {
          this.minFreq = newFreq
        }
      }
    }

    let newFreqSet = this.freqMap.get(newFreq)
    if (!newFreqSet) {
      newFreqSet = new Set()
      this.freqMap.set(newFreq, newFreqSet)
    }
    newFreqSet.add(key)
  }

  private evictIfNeeded(): void {
    if (this.entries.size < this.capacity) return

    const minFreqSet = this.freqMap.get(this.minFreq)
    if (!minFreqSet || minFreqSet.size === 0) return

    // Get the first (oldest) key from the set
    const keyToEvict = minFreqSet.values().next().value
    if (keyToEvict === undefined) return

    minFreqSet.delete(keyToEvict)
    if (minFreqSet.size === 0) {
      this.freqMap.delete(this.minFreq)
    }

    this.entries.delete(keyToEvict)
  }
}
