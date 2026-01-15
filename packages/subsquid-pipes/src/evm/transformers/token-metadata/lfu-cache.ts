import { LFUEntry } from './types.js'

export class LFUCache<V> {
  private readonly capacity: number
  private readonly entries = new Map<string, LFUEntry<V>>()
  private readonly freqMap = new Map<number, Set<string>>()
  private minFreq = 0

  constructor(capacity: number) {
    this.capacity = capacity
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.bumpFrequency(key, entry)
    return entry.value
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  set(key: string, value: V, pinned = false) {
    if (this.capacity <= 0) return

    const existing = this.entries.get(key)
    if (existing) {
      existing.value = value
      existing.pinned = existing.pinned || pinned
      this.bumpFrequency(key, existing)
      return
    }

    if (!this.evictIfNeeded()) {
      return
    }

    const entry: LFUEntry<V> = { value, freq: 1, pinned }
    this.entries.set(key, entry)
    this.addToFreqMap(1, key)
    this.minFreq = 1
  }

  private bumpFrequency(key: string, entry: LFUEntry<V>) {
    this.removeFromFreqMap(entry.freq, key)
    const nextFreq = entry.freq + 1
    entry.freq = nextFreq
    this.addToFreqMap(nextFreq, key)
    if (!this.freqMap.get(this.minFreq)?.size) {
      this.minFreq = this.getLowestFreq()
    }
  }

  private evictIfNeeded(): boolean {
    if (this.entries.size < this.capacity) return true

    const freqs = Array.from(this.freqMap.keys()).sort((a, b) => a - b)
    for (const freq of freqs) {
      const keys = this.freqMap.get(freq)
      if (!keys || keys.size === 0) continue
      const keyToDelete = Array.from(keys).find((k) => !this.entries.get(k)?.pinned)
      if (keyToDelete) {
        this.removeFromFreqMap(freq, keyToDelete)
        this.entries.delete(keyToDelete)
        this.minFreq = this.getLowestFreq()
        return true
      }
    }

    // Cannot evict (all entries pinned).
    return false
  }

  private addToFreqMap(freq: number, key: string) {
    if (!this.freqMap.has(freq)) this.freqMap.set(freq, new Set())
    this.freqMap.get(freq)!.add(key)
  }

  private removeFromFreqMap(freq: number, key: string) {
    const set = this.freqMap.get(freq)
    if (!set) return
    set.delete(key)
    if (!set.size) this.freqMap.delete(freq)
  }

  private getLowestFreq(): number {
    if (!this.freqMap.size) return 0
    return Math.min(...this.freqMap.keys())
  }
}
