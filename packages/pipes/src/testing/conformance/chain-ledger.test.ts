import { describe, expect, it } from 'vitest'

import { ChainLedger, buildChain } from './chain-ledger.js'

describe('ChainLedger', () => {
  describe('anchor-keyed selection (IB-3)', () => {
    it('serves from fromBlock when the anchor matches the held chain', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }) })

      const response = ledger.answer({ fromBlock: 3, toBlock: 5, parentBlockHash: '0x2' })

      expect(response.statusCode).toBe(200)
      expect(response.statusCode === 200 && response.data.map((b) => b.header.number)).toEqual([3, 4, 5])
    })

    it('accepts a first request that carries no anchor', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 2 }) })

      const response = ledger.answer({ fromBlock: 0, toBlock: 2 })

      expect(response.statusCode).toBe(200)
    })

    it('answers the same anchor identically however many times it is asked', () => {
      // The ordinal script's defect: a restarted SUT re-requests from its recovered cursor and an
      // index-keyed simulator hands out the *next* scripted response instead of the same answer.
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }) })
      const request = { fromBlock: 3, toBlock: 5, parentBlockHash: '0x2' }

      const first = ledger.answer(request)
      ledger.answer({ fromBlock: 6, toBlock: 5, parentBlockHash: '0x5' })
      const afterRestart = ledger.answer(request)

      expect(afterRestart).toEqual(first)
    })

    it('does not judge an anchor below the blocks it holds', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 100, to: 105 }) })

      // Block 49 was never held, so nothing here contradicts the anchor.
      const response = ledger.answer({ fromBlock: 50, parentBlockHash: '0xwhatever' })

      expect(response.statusCode).not.toBe(409)
    })
  })

  describe('fork signalling (IB-4)', () => {
    it('answers 409 when the anchor is off the canonical chain', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }) })
      ledger.fork(3, buildChain({ from: 4, to: 6, hash: (n) => `0x${n}__b` }))

      const response = ledger.answer({ fromBlock: 6, toBlock: 10, parentBlockHash: '0x5' })

      expect(response.statusCode).toBe(409)
      expect(response.statusCode === 409 && response.data.previousBlocks).toEqual([
        { number: 0, hash: '0x0' },
        { number: 1, hash: '0x1' },
        { number: 2, hash: '0x2' },
        { number: 3, hash: '0x3' },
        { number: 4, hash: '0x4__b' },
        { number: 5, hash: '0x5__b' },
      ])
    })

    it('keeps serving the survivors of a fork on their unchanged anchors', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }) })
      ledger.fork(3, buildChain({ from: 4, to: 6, hash: (n) => `0x${n}__b` }))

      // Block 3 survived the reorg, so an anchor on it is still canonical.
      const response = ledger.answer({ fromBlock: 4, toBlock: 6, parentBlockHash: '0x3' })

      expect(response.statusCode).toBe(200)
      expect(response.statusCode === 200 && response.data.map((b) => b.header.hash)).toEqual([
        '0x4__b',
        '0x5__b',
        '0x6__b',
      ])
    })

    it('remembers hashes a fork orphaned', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }) })
      ledger.fork(3, buildChain({ from: 4, to: 5, hash: (n) => `0x${n}__b` }))

      expect(ledger.hasServed('0x5')).toBe(true)
      expect(ledger.chain.map((b) => b.header.hash)).not.toContain('0x5')
    })

    it('bounds the canonical window a 409 carries', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 500 }), forkWindow: 3 })
      ledger.fork(400, buildChain({ from: 401, to: 500, hash: (n) => `0x${n}__b` }))

      const response = ledger.answer({ fromBlock: 501, parentBlockHash: '0x500' })

      expect(response.statusCode === 409 && response.data.previousBlocks.map((b) => b.number)).toEqual([498, 499, 500])
    })
  })

  describe('head and range ends (IB-5, IB-6)', () => {
    it('answers 204 when the request sits above the held head', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }), finalized: { number: 5, hash: '0x5' } })

      const response = ledger.answer({ fromBlock: 6, parentBlockHash: '0x5' })

      expect(response.statusCode).toBe(204)
      expect(response.statusCode === 204 && response.head?.finalized).toEqual({ number: 5, hash: '0x5' })
    })

    it('answers an empty 200 once the configured range is exhausted', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 10 }) })

      const response = ledger.answer({ fromBlock: 6, toBlock: 5, parentBlockHash: '0x5' })

      expect(response.statusCode).toBe(200)
      expect(response.statusCode === 200 && response.data).toEqual([])
    })

    it('reports a regressed finalized head verbatim, leaving the clamp to the SUT', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }) })
      ledger.setFinalized({ number: 5, hash: '0x5' })
      ledger.setFinalized({ number: 2, hash: '0x2' })

      const response = ledger.answer({ fromBlock: 0 })

      expect(response.statusCode === 200 && response.head?.finalized).toEqual({ number: 2, hash: '0x2' })
    })

    it('caps a response at batchSize', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 10 }), batchSize: 3 })

      const response = ledger.answer({ fromBlock: 0, toBlock: 10 })

      expect(response.statusCode === 200 && response.data.map((b) => b.header.number)).toEqual([0, 1, 2])
    })
  })

  describe('faults and adversarial histories', () => {
    it('serves queued faults before resuming derived answers', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 2 }) })
      ledger.injectFaults({ statusCode: 503, retryAfter: 1 }, { statusCode: 429 })

      expect(ledger.answer({ fromBlock: 0 })).toEqual({ statusCode: 503, retryAfter: 1 })
      expect(ledger.answer({ fromBlock: 0 })).toEqual({ statusCode: 429 })
      expect(ledger.answer({ fromBlock: 0 }).statusCode).toBe(200)
    })

    it('over-returns past toBlock on demand (INV-24)', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 10 }) })
      ledger.setAdversary({ overReturn: 2 })

      const response = ledger.answer({ fromBlock: 0, toBlock: 3 })

      expect(response.statusCode === 200 && response.data.map((b) => b.header.number)).toEqual([0, 1, 2, 3, 4, 5])
    })

    it('emits duplicate and out-of-order blocks on demand (GAP-29)', () => {
      const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 3 }) })
      ledger.setAdversary({ duplicateBlocks: true, outOfOrder: true })

      const response = ledger.answer({ fromBlock: 0, toBlock: 3 })

      expect(response.statusCode === 200 && response.data.map((b) => b.header.number)).toEqual([3, 2, 1, 0, 0])
    })
  })

  it('retains a request log the ordinal simulator throws away', () => {
    const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }) })

    ledger.answer({ fromBlock: 0, toBlock: 5 })
    ledger.answer({ fromBlock: 6, toBlock: 5, parentBlockHash: '0x5' })

    expect(ledger.requests).toEqual([
      { seq: 0, fromBlock: 0, toBlock: 5, parentBlockHash: undefined, statusCode: 200 },
      { seq: 1, fromBlock: 6, toBlock: 5, parentBlockHash: '0x5', statusCode: 200 },
    ])
  })
})
