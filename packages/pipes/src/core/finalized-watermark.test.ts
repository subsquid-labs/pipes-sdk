import { describe, expect, it } from 'vitest'

import { FinalizedWatermark, maxFinalized, normalizeFinalized } from './finalized-watermark.js'

function block(number: number, hash?: string) {
  return { number, hash: hash ?? `0x${number}` }
}

describe('maxFinalized', () => {
  it('returns the higher-numbered cursor', () => {
    expect(maxFinalized(block(10), block(5))).toEqual(block(10))
    expect(maxFinalized(block(5), block(10))).toEqual(block(10))
  })

  it('treats undefined as the lowest head', () => {
    expect(maxFinalized(undefined, block(5))).toEqual(block(5))
    expect(maxFinalized(block(5), undefined)).toEqual(block(5))
    expect(maxFinalized(undefined, undefined)).toBeUndefined()
  })

  it('keeps the first argument on a tie', () => {
    const a = block(7, '0xaa')
    const b = block(7, '0xbb')
    expect(maxFinalized(a, b)).toBe(a)
  })
})

describe('normalizeFinalized', () => {
  it('passes through a valid cursor', () => {
    expect(normalizeFinalized(block(3))).toEqual(block(3))
  })

  it('rejects empty / partial persisted values', () => {
    expect(normalizeFinalized({})).toBeUndefined()
    expect(normalizeFinalized(undefined)).toBeUndefined()
    expect(normalizeFinalized(null)).toBeUndefined()
    expect(normalizeFinalized({ hash: '0x1' })).toBeUndefined()
  })
})

describe('FinalizedWatermark', () => {
  it('advances the floor monotonically across batches', () => {
    const wm = new FinalizedWatermark()

    expect(wm.clamp(block(10))).toEqual(block(10))
    expect(wm.floor).toEqual(block(10))

    expect(wm.clamp(block(25))).toEqual(block(25))
    expect(wm.floor).toEqual(block(25))
  })

  it('never lets the floor regress (the restart-mid-fork case)', () => {
    // Seeded from persisted state on restart: a source previously finalized 100.
    const wm = new FinalizedWatermark(block(100))

    // A different source now reports finalized 80 (deeper confirmation depth); the floor holds.
    expect(wm.clamp(block(80))).toEqual(block(100))
    expect(wm.floor).toEqual(block(100))
  })

  it('passes through undefined for a no-finality dataset', () => {
    const wm = new FinalizedWatermark()

    expect(wm.clamp(undefined)).toBeUndefined()
    expect(wm.floor).toBeUndefined()
  })

  it('seed keeps the higher cursor', () => {
    const wm = new FinalizedWatermark(block(50))
    wm.seed(block(30))
    expect(wm.floor).toEqual(block(50))
    wm.seed(block(70))
    expect(wm.floor).toEqual(block(70))
    wm.seed(undefined)
    expect(wm.floor).toEqual(block(70))
  })
})
