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
   * Resolve the safe cursor for a reorg from the accumulated rollback chain and
   * the portal's `previousBlocks`, drop every buffered row above it, and return
   * that cursor (or `null` on a dead-end fork). Drive this straight from the
   * target's `fork` handler.
   */
  fork(previousBlocks: BlockCursor[]): Promise<BlockCursor | null>

  /** Number of rows currently buffered (seen, but not yet finalized). */
  readonly size: number
}

/**
 * In-memory buffer that releases stream rows only once their block has finalized.
 *
 * Blockchain data can reorg up to the finalized head, so a target that writes to
 * immutable storage (Parquet files, append-only logs, …) must hold a row back
 * until its block finalizes. This buffer owns a pipe's unfinalized state — the
 * rows *and* the rollback chain — and resolves reorgs itself via {@link FinalizationBuffer.fork},
 * so the target never has to track the chain or re-derive the safe cursor.
 *
 * Memory is bounded by the chain's finality depth: only unfinalized rows and
 * cursors are held, never the already-finalized output.
 *
 * @example
 * const buffer = createFinalizationBuffer<MyRow>({ getBlockNumber: (r) => r.blockNumber })
 * // write():
 * for await (const { data, ctx } of read()) {
 *   const finalized = buffer.push(data, {
 *     finalized: ctx.stream.head.finalized,
 *     rollbackChain: ctx.stream.state.rollbackChain,
 *   })
 *   if (finalized.length) await write(finalized)
 * }
 * // fork():
 * return buffer.fork(previousBlocks)
 */
export function createFinalizationBuffer<Row>({
  getBlockNumber,
}: {
  getBlockNumber: (row: Row) => number
}): FinalizationBuffer<Row> {
  let buffered: Row[] = []
  let rollbackChain: BlockCursor[] = []
  let finalized: BlockCursor | undefined

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

    async fork(previousBlocks) {
      const safe = await resolveForkCursor([{ rollbackChain, finalized }], previousBlocks)

      if (safe) {
        const boundary = safe.number
        rollbackChain = rollbackChain.filter((block) => block.number <= boundary)
        buffered = buffered.filter((row) => getBlockNumber(row) <= boundary)
      } else {
        rollbackChain = []
      }

      return safe
    },

    get size() {
      return buffered.length
    },
  }
}
