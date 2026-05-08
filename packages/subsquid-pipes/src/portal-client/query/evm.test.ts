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

function castAccessList(accessList: unknown) {
  const schema = getBlockSchema({ transaction: { accessList: true } })
  const block = {
    header: {},
    transactions: [{ accessList }],
  }
  return cast(schema, block).transactions[0].accessList
}

describe('TransactionFields accessList validation', () => {
  const ADDR = `0x${'ab'.repeat(20)}`
  const KEY = `0x${'cd'.repeat(32)}`

  it('parses entries with address and storage keys', () => {
    expect(
      castAccessList([
        { address: ADDR, storageKeys: [KEY, KEY] },
        { address: ADDR, storageKeys: [] },
      ]),
    ).toEqual([
      { address: ADDR, storageKeys: [KEY, KEY] },
      { address: ADDR, storageKeys: [] },
    ])
  })

  it('is optional (undefined when the field is absent)', () => {
    const schema = getBlockSchema({ transaction: { accessList: true } })
    const out = cast(schema, { header: {}, transactions: [{}] })
    expect(out.transactions[0].accessList).toBeUndefined()
  })

  it('rejects a non-hex address', () => {
    expect(() => castAccessList([{ address: 'nothex', storageKeys: [] }])).toThrow()
  })
})

describe('TraceSuicideAction.refundAddress validation', () => {
  function castSuicideTrace(refundAddress: unknown) {
    const schema = getBlockSchema({
      trace: {
        type: true,
        transactionIndex: true,
        traceAddress: true,
        subtraces: true,
        error: true,
        suicideAddress: true,
        suicideRefundAddress: true,
        suicideBalance: true,
      },
    })
    const block = {
      header: {},
      traces: [
        {
          type: 'suicide',
          transactionIndex: 0,
          traceAddress: [],
          subtraces: 0,
          error: null,
          action: {
            address: '0x0000000000000000000000000000000000000001',
            refundAddress,
            balance: '0x0',
          },
        },
      ],
    }
    return cast(schema, block).traces[0]
  }

  it('accepts null refundAddress (real SELFDESTRUCT edge case)', () => {
    const trace = castSuicideTrace(null) as { action: { refundAddress: unknown } }
    expect(trace.action.refundAddress).toBeNull()
  })

  it('accepts a valid hex refundAddress', () => {
    const trace = castSuicideTrace('0x000000000000000000000000000000000000dead') as {
      action: { refundAddress: unknown }
    }
    expect(trace.action.refundAddress).toBe('0x000000000000000000000000000000000000dead')
  })

  it('rejects a non-hex refundAddress', () => {
    expect(() => castSuicideTrace('not-hex')).toThrow()
  })
})
