import { resolveForkCursor } from './fork.js'
import { BlockCursor } from './types.js'

/** A batch's finalization state: the finalized head plus the unfinalized rollback chain. */
export type Finalization = {
  /** Highest finalized block, or `undefined` for a no-finality dataset. */
  finalized?: BlockCursor
  /** Blocks newer than `finalized` seen in this batch — kept for fork resolution. */
  rollbackChain?: BlockCursor[]
}

export type FinalizationBuffer<Row> = {
  /**
   * Append `rows`, fold in this batch's finalization state, then return the rows
   * now at or below the finalized head in arrival/block order; the rest stay
   * buffered until a later, higher finalized head releases them (or a reorg
   * drops them). Pass an empty `rows` array to flush after the head advances.
   *
   * `finalized === undefined` means a no-finality dataset: the threshold is
   * `Infinity`, so every row passes straight through and nothing is buffered.
   */
  push(rows: Row[], finalization: Finalization): Row[]

  /**
   * Resolve the safe cursor for a reorg from the accumulated rollback chain and the portal's
   * canonical block list (a.k.a. `previousBlocks` from Portal API `/stream` 409 responses),
   * WITHOUT mutating the buffer. Returns that cursor (or `null` on a dead-end fork).
   * Pair with {@link dropAbove}, or use {@link resolveFork} to do both in one call.
   *
   * Sibling buffers advanced in lockstep carry an identical chain, so a caller with many buffers
   * can resolve the cursor once and apply it to all of them via {@link dropAbove} instead of
   * re-resolving the same walk per buffer.
   */
  resolveForkCursor(canonicalBlocks: BlockCursor[]): Promise<BlockCursor | null>

  /**
   * Drop every buffered row above `safe` and trim the rollback chain to it — or, on a `null`
   * dead-end fork, keep the rows and reset the chain. Feed it a cursor from {@link resolveForkCursor}.
   */
  dropAbove(safe: BlockCursor | null): void

  /**
   * Resolve the safe cursor and drop every buffered row above it — {@link resolveForkCursor} then
   * {@link dropAbove} in one call. Convenient as the body of a single-buffer target's
   * `resolveFork` handler.
   *
   * NOTE (rename migration): before 1.0.0-alpha.17 the name `resolveFork` belonged to the
   * non-mutating variant, now called {@link resolveForkCursor}.
   */
  resolveFork(canonicalBlocks: BlockCursor[]): Promise<BlockCursor | null>

  /** Number of rows currently buffered (seen, but not yet finalized). */
  readonly size: number
}

/**
 * In-memory buffer that releases stream rows only once their block has finalized.
 *
 * Blockchain data can reorg up to the finalized head, so a target that writes to
 * immutable storage (Parquet files, append-only logs, …) must hold a row back
 * until its block finalizes. This buffer owns a pipe's unfinalized state — the
 * rows *and* the rollback chain — and resolves reorgs itself via {@link FinalizationBuffer.resolveFork},
 * so the target never has to track the chain or re-derive the safe cursor.
 *
 * Memory is bounded by the chain's finality depth: only unfinalized rows and
 * cursors are held, never the already-finalized output.
 *
 * @example
 * const buffer = finalizationBuffer<MyRow>({ getBlockNumber: (r) => r.blockNumber })
 * // write():
 * for await (const { data, ctx } of read()) {
 *   const finalized = buffer.push(data, {
 *     finalized: ctx.stream.head.finalized,
 *     rollbackChain: ctx.stream.state.rollbackChain,
 *   })
 *   if (finalized.length) await write(finalized)
 * }
 * // resolveFork():
 * return buffer.resolveFork(canonicalBlocks)
 */
export function finalizationBuffer<Row>({
  getBlockNumber,
}: {
  getBlockNumber: (row: Row) => number
}): FinalizationBuffer<Row> {
  let buffered: Row[] = []
  let rollbackChain: BlockCursor[] = []
  let finalized: BlockCursor | undefined

  const resolveCursor = (canonicalBlocks: BlockCursor[]): Promise<BlockCursor | null> =>
    resolveForkCursor([{ rollbackChain, finalized }], canonicalBlocks)

  const dropAbove = (safe: BlockCursor | null): void => {
    if (safe) {
      const boundary = safe.number
      rollbackChain = rollbackChain.filter((block) => block.number <= boundary)
      buffered = buffered.filter((row) => getBlockNumber(row) <= boundary)
    } else {
      rollbackChain = []
    }
  }

  return {
    push(rows, finalization) {
      rollbackChain.push(...(finalization.rollbackChain ?? []))
      finalized = finalization.finalized
      const threshold = finalized?.number ?? Infinity

      // Finalized blocks can never reorg, so keep the chain to unfinalized blocks
      // only — otherwise it grows without bound over a long run.
      if (finalized) {
        const boundary = finalized.number
        rollbackChain = rollbackChain.filter((block) => block.number > boundary)
      }

      const released: Row[] = []
      const stillBuffered: Row[] = []

      // Split the whole buffer — previously-held rows first, then this batch's
      // arrivals — so released rows keep their arrival/block order.
      for (const row of buffered.length ? [...buffered, ...rows] : rows) {
        if (getBlockNumber(row) <= threshold) {
          released.push(row)
        } else {
          stillBuffered.push(row)
        }
      }

      buffered = stillBuffered

      return released
    },

    resolveForkCursor: resolveCursor,

    dropAbove,

    async resolveFork(canonicalBlocks) {
      const safe = await resolveCursor(canonicalBlocks)
      dropAbove(safe)

      return safe
    },

    get size() {
      return buffered.length
    },
  }
}
