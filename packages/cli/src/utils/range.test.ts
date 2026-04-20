import { describe, expect, it } from 'vitest'

import { oldestRange } from './range.js'

describe('oldestRange', () => {
  it('returns the range with the smaller numeric `from`', () => {
    const a = { from: '200' }
    const b = { from: '100' }
    expect(oldestRange(a, b)).toBe(b)
  })

  it('normalizes comma-formatted numbers (en-US locale output)', () => {
    const a = { from: '2,000,000' }
    const b = { from: '1,000,000' }
    expect(oldestRange(a, b)).toBe(b)
  })

  it('normalizes underscore-separated numbers (JS numeric literal style)', () => {
    const a = { from: '2_000_000' }
    const b = { from: '1_000_000' }
    expect(oldestRange(a, b)).toBe(b)
  })

  it('treats `latest` as newer than any concrete block (concrete wins)', () => {
    const a = { from: 'latest' }
    const b = { from: '1000' }
    expect(oldestRange(a, b)).toBe(b)
    expect(oldestRange(b, a)).toBe(b)
  })

  it('keeps the first argument when both inputs are non-numeric (stable)', () => {
    const a = { from: 'latest' }
    const b = { from: 'latest' }
    expect(oldestRange(a, b)).toBe(a)
  })

  it('keeps the valid side when one input is unparseable garbage', () => {
    const a = { from: 'not-a-number' }
    const b = { from: '1000' }
    expect(oldestRange(a, b)).toBe(b)
    expect(oldestRange(b, a)).toBe(b)
  })
})
