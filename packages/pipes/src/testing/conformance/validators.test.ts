import { describe, expect, it } from 'vitest'

import {
  assertStructure,
  validateDecodable,
  validateInRange,
  validateItemsBelongToParent,
  validateLinked,
  validateOrdered,
  validateStructure,
  validateWatermarks,
} from './validators.js'

const cursor = (number: number) => ({ number, hash: `0x${number}` })

describe('structural validators', () => {
  describe('decodable', () => {
    it('passes when every item parses', () => {
      expect(validateDecodable(['{"a":1}', '{"b":2}'], (s) => JSON.parse(s))).toEqual([])
    })

    it('names the item that does not parse', () => {
      const violations = validateDecodable(['{"a":1}', 'not json'], (s) => JSON.parse(s))

      expect(violations).toHaveLength(1)
      expect(violations[0]).toMatchObject({ validator: 'decodable', property: 'INV-5' })
      expect(violations[0].message).toMatch(/item 1/)
    })
  })

  describe('ordered', () => {
    it('accepts strictly ascending attribution', () => {
      expect(validateOrdered([{ block: 1 }, { block: 2 }, { block: 5 }])).toEqual([])
    })

    it('rejects a repeated block by default', () => {
      expect(validateOrdered([{ block: 1 }, { block: 1 }])).toHaveLength(1)
    })

    it('allows repeats when attribution is only required non-decreasing', () => {
      expect(validateOrdered([{ block: 1 }, { block: 1 }], { strict: false })).toEqual([])
    })

    it('rejects a descending step', () => {
      const violations = validateOrdered([{ block: 3 }, { block: 2 }])

      expect(violations[0].message).toMatch(/3 → 2/)
    })
  })

  describe('linked', () => {
    it('accepts a batch that continues from the cursor', () => {
      expect(validateLinked([{ cursorBefore: 4, blocks: [{ number: 5 }, { number: 6 }] }])).toEqual([])
    })

    it('rejects a gap', () => {
      const violations = validateLinked([{ cursorBefore: 4, blocks: [{ number: 7 }] }])

      expect(violations[0].message).toMatch(/starts at 7, expected 5/)
    })

    it('skips batches with no known preceding cursor', () => {
      expect(validateLinked([{ blocks: [{ number: 99 }] }])).toEqual([])
    })
  })

  describe('items-belong-to-parent', () => {
    it('accepts rows inside their unit window', () => {
      const units = [{ name: '0-9.parquet', from: 0, to: 9, rows: [{ block: 0 }, { block: 9 }] }]

      expect(validateItemsBelongToParent(units)).toEqual([])
    })

    it('rejects a row outside the window its unit claims', () => {
      const units = [{ name: '0-9.parquet', from: 0, to: 9, rows: [{ block: 10 }] }]

      expect(validateItemsBelongToParent(units)[0].message).toMatch(/claims \[0, 9\] but holds a row at 10/)
    })
  })

  describe('in-range', () => {
    it('accepts attribution covered by a configured range', () => {
      expect(validateInRange([{ block: 5 }], [{ from: 0, to: 10 }])).toEqual([])
    })

    it('accepts attribution covered by any of several disjoint ranges', () => {
      expect(
        validateInRange(
          [{ block: 50 }],
          [
            { from: 0, to: 10 },
            { from: 40, to: 60 },
          ],
        ),
      ).toEqual([])
    })

    it('rejects attribution outside every range', () => {
      expect(
        validateInRange(
          [{ block: 20 }],
          [
            { from: 0, to: 10 },
            { from: 40, to: 60 },
          ],
        ),
      ).toHaveLength(1)
    })

    it('treats an open-ended range as unbounded above', () => {
      expect(validateInRange([{ block: 1_000_000 }], [{ from: 0 }])).toEqual([])
    })
  })

  describe('watermark coherence', () => {
    it('accepts a chain strictly above the floor and at or below the cursor', () => {
      const state = { current: cursor(5), finalized: cursor(2), rollbackChain: [cursor(3), cursor(4), cursor(5)] }

      expect(validateWatermarks(state)).toEqual([])
    })

    it('rejects a chain entry at or below the floor (INV-1)', () => {
      const state = { current: cursor(5), finalized: cursor(3), rollbackChain: [cursor(3), cursor(4)] }

      expect(validateWatermarks(state)[0].message).toMatch(/at or below the floor 3/)
    })

    it('rejects a chain entry above the cursor (INV-1)', () => {
      const state = { current: cursor(4), finalized: cursor(1), rollbackChain: [cursor(2), cursor(9)] }

      expect(validateWatermarks(state)[0].message).toMatch(/above the cursor 4/)
    })

    it('rejects a chain that is not strictly increasing', () => {
      const state = { current: cursor(5), finalized: cursor(1), rollbackChain: [cursor(3), cursor(3)] }

      expect(validateWatermarks(state).some((v) => /not strictly increasing/.test(v.message))).toBe(true)
    })

    it('rejects a hashless chain entry', () => {
      const state = { current: cursor(5), finalized: cursor(1), rollbackChain: [{ number: 3, hash: '' }] }

      expect(validateWatermarks(state).some((v) => /carries no hash/.test(v.message))).toBe(true)
    })

    it('rejects data reaching above the cursor (INV-5)', () => {
      const state = { current: cursor(5), finalized: cursor(1), rollbackChain: [] }

      expect(validateWatermarks(state, { dataBound: 7 })[0].message).toMatch(/reaches 7, above the cursor 5/)
    })
  })

  describe('combined run', () => {
    it('reports nothing for a coherent observation', () => {
      expect(
        validateStructure({
          rows: [{ block: 1 }, { block: 2 }],
          batches: [{ cursorBefore: 0, blocks: [{ number: 1 }, { number: 2 }] }],
          state: { current: cursor(2), finalized: cursor(1), rollbackChain: [cursor(2)] },
          ranges: [{ from: 0, to: 10 }],
          dataBound: 2,
        }),
      ).toEqual([])
    })

    it('accumulates violations across validators', () => {
      const violations = validateStructure({
        rows: [{ block: 3 }, { block: 2 }],
        batches: [{ cursorBefore: 0, blocks: [{ number: 5 }] }],
        ranges: [{ from: 0, to: 1 }],
      })

      expect(violations.map((v) => v.validator).sort()).toEqual(['in-range', 'in-range', 'linked', 'ordered'])
    })

    it('assertStructure lists every violation it found', () => {
      expect(() => assertStructure({ rows: [{ block: 3 }, { block: 2 }], ranges: [{ from: 0, to: 1 }] })).toThrowError(
        /3 structural violation\(s\)/,
      )
    })

    it('assertStructure stays silent when nothing is broken', () => {
      expect(() => assertStructure({ rows: [{ block: 1 }] })).not.toThrow()
    })
  })
})
