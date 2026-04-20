import { cast } from '@subsquid/util-internal-validation'
import { describe, expect, it } from 'vitest'

import { getBlockSchema } from './evm.js'

function castNonce(nonce: unknown) {
  const schema = getBlockSchema({ transaction: { nonce: true } })
  const block = {
    header: {},
    transactions: [{ nonce }],
  }
  return cast(schema, block).transactions[0].nonce
}

describe('TransactionFields nonce validation', () => {
  it('accepts number and casts to bigint', () => {
    expect(castNonce(42)).toBe(42n)
  })

  it('accepts zero', () => {
    expect(castNonce(0)).toBe(0n)
  })

  it('accepts string and casts to bigint', () => {
    expect(castNonce('42')).toBe(42n)
  })

  it('accepts large numbers as string', () => {
    expect(castNonce('9007199254740993')).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 2n)
  })

  it('rejects negative number', () => {
    expect(() => castNonce(-1)).toThrow()
  })

  it('rejects non-numeric string', () => {
    expect(() => castNonce('abc')).toThrow()
  })

  it('rejects null', () => {
    expect(() => castNonce(null)).toThrow()
  })
  it('rejects float', () => {
    expect(() => castNonce(3.14)).toThrow()
  })
})
