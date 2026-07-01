import { describe, expect, it } from 'vitest'

import { Finalization, createFinalizationBuffer } from './finalization-buffer.js'

type Row = { block: number; tag: string }

function row(block: number, tag = `r${block}`): Row {
  return { block, tag }
}

function block(number: number, hash = `0x${number}`) {
  return { number, hash }
}

// A batch's finalization state: `head(2)` finalizes up to block 2, `head()` is a
// no-finality batch, and an optional rollback chain feeds fork resolution.
function head(finalizedNumber?: number, rollbackChain: { number: number; hash: string }[] = []): Finalization {
  return {
    finalized: finalizedNumber === undefined ? undefined : block(finalizedNumber),
    rollbackChain,
  }
}

function make() {
  return createFinalizationBuffer<Row>({ getBlockNumber: (r) => r.block })
}

describe('createFinalizationBuffer', () => {
  describe('push', () => {
    it('releases rows at or below the finalized head and buffers the rest', () => {
      const buffer = make()

      const finalized = buffer.push([row(1), row(2), row(3)], head(2))

      expect(finalized).toEqual([row(1), row(2)])
      expect(buffer.size).toBe(1)
    })

    it('treats the threshold as inclusive (<=)', () => {
      const buffer = make()

      expect(buffer.push([row(5)], head(5))).toEqual([row(5)])
      expect(buffer.size).toBe(0)
    })

    it('accepts a finalization without a rollback chain', () => {
      const buffer = make()

      expect(buffer.push([row(1), row(2)], { finalized: block(1) })).toEqual([row(1)])
      expect(buffer.size).toBe(1)
    })

    it('does not mutate the input array', () => {
      const buffer = make()
      const input = [row(1), row(2)]

      buffer.push(input, head(1))

      expect(input).toEqual([row(1), row(2)])
    })

    it('returns a fresh array, not internal state', () => {
      const buffer = make()

      const a = buffer.push([row(1)], head(1))
      const b = buffer.push([row(2)], head(2))

      expect(a).toEqual([row(1)])
      expect(b).toEqual([row(2)])
      expect(a).not.toBe(b)
    })
  })

  describe('cross-batch release', () => {
    it('releases earlier-buffered rows once a later batch finalizes them', () => {
      const buffer = make()

      expect(buffer.push([row(10), row(11)], head(9))).toEqual([])
      expect(buffer.size).toBe(2)

      expect(buffer.push([row(12), row(13)], head(11))).toEqual([row(10), row(11)])
      expect(buffer.size).toBe(2)
    })

    it('releases buffered rows on an empty push after the head advances', () => {
      const buffer = make()

      buffer.push([row(5), row(6), row(7)], head(4))
      expect(buffer.size).toBe(3)

      expect(buffer.push([], head(6))).toEqual([row(5), row(6)])
      expect(buffer.size).toBe(1)
    })
  })

  describe('ordering', () => {
    it('emits previously-buffered rows before the current batch on the same flush', () => {
      const buffer = make()

      buffer.push([row(10)], head(5))

      expect(buffer.push([row(11), row(12)], head(11))).toEqual([row(10), row(11)])
      expect(buffer.size).toBe(1)
    })

    it('preserves arrival order within a batch (does not sort)', () => {
      const buffer = make()

      expect(buffer.push([row(5, 'a'), row(3, 'b'), row(4, 'c')], head(9))).toEqual([
        row(5, 'a'),
        row(3, 'b'),
        row(4, 'c'),
      ])
    })
  })

  describe('no-finality passthrough', () => {
    it('releases everything immediately when the finalized head is undefined', () => {
      const buffer = make()

      expect(buffer.push([row(1), row(2), row(3)], head())).toEqual([row(1), row(2), row(3)])
      expect(buffer.size).toBe(0)
    })

    it('never buffers across repeated no-finality batches', () => {
      const buffer = make()

      buffer.push([row(1)], head())
      buffer.push([row(2)], head())

      expect(buffer.size).toBe(0)
    })

    it('honours a finalized head of 0 instead of treating it as no-finality', () => {
      const buffer = make()

      // `?? Infinity` (not `|| Infinity`): block 0 is a real finalized boundary.
      expect(buffer.push([row(0), row(1)], head(0))).toEqual([row(0)])
      expect(buffer.size).toBe(1)
    })
  })

  describe('fork', () => {
    it('resolves the safe cursor and drops every buffered row above it', async () => {
      const buffer = make()

      buffer.push([row(5), row(6), row(7)], head(4, [block(5), block(6), block(7)]))

      const safe = await buffer.fork([block(5), block(6, '0x6a'), block(7, '0x7a')])

      expect(safe).toEqual(block(5))
      expect(buffer.size).toBe(1) // only row(5) survives
    })

    it('returns null on a dead-end fork, keeping rows and resetting the chain', async () => {
      const buffer = make()

      buffer.push([row(5), row(6)], head(4, [block(5, '0x5a'), block(6, '0x6a')]))

      const safe = await buffer.fork([block(5, '0x5b'), block(6, '0x6b')])

      expect(safe).toBeNull()
      expect(buffer.size).toBe(2) // rows left untouched on a dead end
    })

    it('cannot roll back to a block that has since finalized', async () => {
      const buffer = make()

      // The chain sees 5 & 6 while unfinalized…
      buffer.push([], head(4, [block(5), block(6)]))
      // …then the head advances past them, pruning them from the chain.
      buffer.push([], head(6))

      expect(await buffer.fork([block(5), block(6)])).toBeNull()
    })
  })

  describe('resolveFork / dropAbove (split fork for shared-chain buffers)', () => {
    it('resolveFork resolves the safe cursor without mutating the buffer', async () => {
      const buffer = make()
      buffer.push([row(5), row(6), row(7)], head(4, [block(5), block(6), block(7)]))

      const safe = await buffer.resolveFork([block(5), block(6, '0x6a'), block(7, '0x7a')])

      expect(safe).toEqual(block(5))
      // Side-effect-free (unlike fork): rows stay buffered…
      expect(buffer.size).toBe(3)
      // …and a second resolve on the untouched chain returns the same cursor.
      expect(await buffer.resolveFork([block(5), block(6, '0x6a'), block(7, '0x7a')])).toEqual(block(5))
      expect(buffer.size).toBe(3)
    })

    it('dropAbove drops every buffered row above the given cursor', () => {
      const buffer = make()
      buffer.push([row(5), row(6), row(7)], head(4, [block(5), block(6), block(7)]))

      buffer.dropAbove(block(5))

      expect(buffer.size).toBe(1) // only row(5) survives
    })

    it('dropAbove(null) keeps rows for a dead-end fork', () => {
      const buffer = make()
      buffer.push([row(5), row(6)], head(4, [block(5), block(6)]))

      buffer.dropAbove(null)

      expect(buffer.size).toBe(2)
    })

    it('resolves once and drops across sibling buffers that share the chain (ParquetStore pattern)', async () => {
      // Buffers advanced in lockstep carry identical chains, so the cursor is resolved from one
      // and applied to every buffer — no per-buffer re-resolution.
      const a = make()
      const b = make()
      const fin = head(4, [block(5), block(6), block(7)])
      a.push([row(5), row(6), row(7)], fin)
      b.push([row(5), row(6), row(7)], fin)

      const safe = await a.resolveFork([block(5), block(6, '0x6a'), block(7, '0x7a')])
      a.dropAbove(safe)
      b.dropAbove(safe)

      expect(safe).toEqual(block(5))
      expect(a.size).toBe(1)
      expect(b.size).toBe(1)
    })
  })

  describe('size', () => {
    it('reflects the number of buffered rows after each push', () => {
      const buffer = make()

      expect(buffer.size).toBe(0)

      buffer.push([row(10), row(11), row(12)], head(9))
      expect(buffer.size).toBe(3)

      buffer.push([], head(10))
      expect(buffer.size).toBe(2)

      buffer.push([], head(11))
      expect(buffer.size).toBe(1)

      buffer.push([], head(12))
      expect(buffer.size).toBe(0)
    })
  })
})
