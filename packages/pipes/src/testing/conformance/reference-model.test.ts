import { describe, expect, it } from 'vitest'

import { ORACLE_ERRORS, type OracleRow, ReferenceModel } from './reference-model.js'

const block = (number: number, suffix = '') => ({ number, hash: `0x${number}${suffix}` })
const blocks = (from: number, to: number, suffix = '') => {
  const out = []
  for (let n = from; n <= to; n++) {
    out.push(block(n, suffix))
  }

  return out
}

describe('ReferenceModel', () => {
  describe('T-BATCH', () => {
    it('advances the cursor to the last block of the batch', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })

      model.batch(blocks(0, 3))

      expect(model.readState().current).toEqual(block(3))
    })

    it('refuses a batch that does not continue from the cursor (INV-20)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.batch(blocks(0, 3))

      expect(() => model.batch(blocks(5, 6))).toThrowError(/expected 4/)
    })

    it('refuses a batch that is not strictly ascending (INV-20)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })

      expect(() => model.batch([block(0), block(2), block(1)])).toThrowError(/not strictly ascending/)
    })

    it('refuses blocks past the configured end (INV-24)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0, to: 3 } })

      expect(() => model.batch(blocks(0, 5))).toThrowError(/above the configured end/)
    })

    it('never lowers the floor, however the portal reports it (INV-12)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })

      model.batch(blocks(0, 3), { finalized: block(3) })
      model.batch(blocks(4, 5), { finalized: block(1) })

      expect(model.readState().finalized).toEqual(block(3))
    })

    it('keeps the rollback chain to exactly the processed blocks above the floor (INV-1)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })

      model.batch(blocks(0, 5), { finalized: block(2) })

      expect(model.readState().rollbackChain.map((b) => b.number)).toEqual([3, 4, 5])
    })
  })

  describe('hold-back (DEF-15)', () => {
    it('releases only finalized rows for a deferred class', () => {
      const model = new ReferenceModel({ durability: 'K', range: { from: 0 } })

      model.batch(blocks(0, 5), { finalized: block(2) })

      expect(model.data.map((r) => r.block)).toEqual([0, 1, 2])
      expect(model.buffered.map((r) => r.block)).toEqual([3, 4, 5])
    })

    it('releases buffered rows once the floor reaches them', () => {
      const model = new ReferenceModel({ durability: 'K', range: { from: 0 } })

      model.batch(blocks(0, 5), { finalized: block(2) })
      model.batch(blocks(6, 7), { finalized: block(6) })

      expect(model.data.map((r) => r.block)).toEqual([0, 1, 2, 3, 4, 5, 6])
      expect(model.buffered.map((r) => r.block)).toEqual([7])
    })

    it('commits every row immediately for a transactional class', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })

      model.batch(blocks(0, 5), { finalized: block(2) })

      expect(model.data.map((r) => r.block)).toEqual([0, 1, 2, 3, 4, 5])
      expect(model.buffered).toEqual([])
    })
  })

  describe('T-FORK (WP-40…WP-44)', () => {
    it('rewinds to the newest block both chains agree on', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.batch(blocks(0, 5), { finalized: block(1) })

      const ancestor = model.fork([...blocks(0, 3), block(4, '__b'), block(5, '__b')])

      expect(ancestor).toEqual(block(3))
      expect(model.readState().current).toEqual(block(3))
      expect(model.data.map((r) => r.block)).toEqual([0, 1, 2, 3])
    })

    it('leaves the floor untouched when it rewinds (INV-13, INV-14)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.batch(blocks(0, 5), { finalized: block(1) })

      model.fork([...blocks(0, 3), block(4, '__b'), block(5, '__b')])

      expect(model.readState().finalized).toEqual(block(1))
    })

    it('drops rollback-chain entries above the ancestor', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.batch(blocks(0, 5), { finalized: block(1) })

      model.fork([...blocks(0, 3), block(4, '__b'), block(5, '__b')])

      expect(model.readState().rollbackChain.map((b) => b.number)).toEqual([2, 3])
    })

    it('refuses an empty canonical chain (WP-41)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.batch(blocks(0, 3))

      expect(() => model.fork([])).toThrowError(/empty canonical chain/)
    })

    it('refuses a canonical chain that ends below the cursor (RP-43)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.batch(blocks(0, 5))

      expect(() => model.fork(blocks(0, 2, '__b'))).toThrowError(/below the committed cursor/)
    })

    it('refuses to rewind below the finalized floor (WP-44)', () => {
      // Only reachable from state INV-1 already forbids: a rollback record whose chain dips below
      // its own floor. Against conforming state the window is exhausted first and the search ends
      // in "no ancestor" instead — see the note on this branch in the gap register.
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.recover({
        current: block(7, '__a'),
        finalized: block(5),
        rollbackChain: [],
        history: [{ rollbackChain: [block(3, '__a'), block(7, '__a')], finalized: block(5) }],
      })

      expect(() => model.fork([block(7, '__b')])).toThrowError(/below the finalized floor/)
    })

    it('ends in "no ancestor" rather than a finality conflict when the state is well-formed', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.batch(blocks(0, 5), { finalized: block(4) })

      expect(() => model.fork([block(9, '__b')])).toThrowError(/no common ancestor/)
    })

    it('falls back to the floor when it is the last canonical block standing (WP-42)', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })
      model.batch(blocks(0, 3), { finalized: block(1) })

      // Only block 1 (the floor) survives the narrowing; blocks 2–3 are orphaned.
      const ancestor = model.fork([block(1), block(2, '__b'), block(3, '__b')])

      expect(ancestor).toEqual(block(1))
    })
  })

  describe('T-INIT', () => {
    it('drops rows the cursor does not cover (CN-40…CN-44, INV-42)', () => {
      const model = new ReferenceModel({ durability: 'K', range: { from: 0 } })
      model.batch(blocks(0, 5), { finalized: block(5) })

      model.recover({ current: block(3), finalized: block(3), rollbackChain: [] })

      expect(model.data.map((r) => r.block)).toEqual([0, 1, 2, 3])
      expect(model.readState().current).toEqual(block(3))
    })

    it('refuses malformed persisted state (INV-5)', () => {
      const model = new ReferenceModel({ durability: 'T' })

      expect(() =>
        model.recover({ current: { hash: '0x1' } as any, finalized: undefined, rollbackChain: [] }),
      ).toThrowError(/no block number/)
    })

    it('starts cold when there is nothing persisted', () => {
      const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })

      model.recover(undefined)

      expect(model.readState().current).toBeUndefined()
    })
  })

  it('applies the supplied transform rather than assuming one row per block (RS-10)', () => {
    const transform = (b: { number: number }): OracleRow[] => [
      { table: 'blocks', block: b.number, value: b.number },
      { table: 'logs', block: b.number, value: b.number * 2 },
    ]
    const model = new ReferenceModel({ durability: 'T', range: { from: 0 }, transform })

    model.batch(blocks(0, 1))

    expect(model.data).toEqual([
      { table: 'blocks', block: 0, value: 0 },
      { table: 'logs', block: 0, value: 0 },
      { table: 'blocks', block: 1, value: 1 },
      { table: 'logs', block: 1, value: 2 },
    ])
  })

  it('tracks the next coverage window per table (INV-4)', () => {
    const model = new ReferenceModel({ durability: 'T', range: { from: 0 } })

    model.batch(blocks(0, 4))

    expect(model.coverage).toEqual({ blocks: 5 })
  })
})
