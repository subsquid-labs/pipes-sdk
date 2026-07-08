import { describe, expect, it } from 'vitest'

import { shimWireBlock } from './shim.js'

/**
 * `shimWireBlock` reconciles the two enumerable trace-level differences between the normalized model
 * (`@subsquid/evm-normalization` `toJSON`) and the Portal wire schema. Mirrors the Squid
 * evm-rpc-stream shim tests.
 */

describe('shimWireBlock', () => {
  it('rewrites the selfdestruct trace tag to suicide', () => {
    const block = { traces: [{ type: 'selfdestruct', action: { refundAddress: '0xa' } }] }
    shimWireBlock(block)
    expect(block.traces[0].type).toBe('suicide')
  })

  it('renames a reward action rewardType to type', () => {
    const block = { traces: [{ type: 'reward', action: { author: '0xa', rewardType: 'block' } }] }
    shimWireBlock(block)
    expect(block.traces[0].action).toEqual({ author: '0xa', type: 'block' })
    expect('rewardType' in block.traces[0].action).toBe(false)
  })

  it('leaves create / call traces and trace-less blocks untouched', () => {
    const block = {
      traces: [
        { type: 'call', action: { to: '0xa', from: '0xb' } },
        { type: 'create', action: { from: '0xc' } },
      ],
    }
    shimWireBlock(block)
    expect(block.traces[0]).toEqual({ type: 'call', action: { to: '0xa', from: '0xb' } })
    expect(block.traces[1]).toEqual({ type: 'create', action: { from: '0xc' } })

    // no traces at all — must not throw
    expect(() => shimWireBlock({ header: {} })).not.toThrow()
    expect(() => shimWireBlock({})).not.toThrow()
  })
})
