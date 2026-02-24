import { BlockCursor } from './types.js'

export type RollbackRecord = {
  rollbackChain: BlockCursor[]
  finalized?: BlockCursor
}

/**
 * Given an async/sync iterable of historical rollback records (newest first)
 * and the portal's previousBlocks from a ForkException,
 * finds the safe cursor to roll back to.
 *
 * The algorithm walks through each record's rollback chain (sorted DESC by block number)
 * and looks for the latest block that both sides agree on (matching hash).
 *
 * Returns the safe cursor, or null if no common ancestor is found.
 */
export async function resolveForkCursor(
  records: AsyncIterable<RollbackRecord> | Iterable<RollbackRecord>,
  previousBlocks: BlockCursor[],
): Promise<BlockCursor | null> {
  let remaining = [...previousBlocks]

  for await (const { rollbackChain, finalized } of records) {
    if (!rollbackChain.length) continue

    const blocks = [...rollbackChain].sort((a, b) => b.number - a.number)

    for (const block of blocks) {
      const found = remaining.find((u) => u.hash === block.hash)
      if (found) return found

      if (!remaining.length) {
        if (finalized && block.number < finalized.number) {
          /**
           *  We can't go beyond the finalized block.
           *  TODO: Dead end? What should we do?
           */
          return null
        }

        /*
         * This indicates a deep blockchain fork where we've exhausted all previously known blocks.
         * We'll return the current block as the fork point
         * and let the portal fetch a new valid chain of blocks.
         */
        return block
      }

      // Remove already visited blocks
      remaining = remaining.filter((u) => u.number < block.number)
    }

    // If none of the blocks in the rollback chain match, we can still try the finalized block as a fallback
    if (finalized && remaining.length === 1 && remaining[0].hash === finalized.hash) {
      return finalized
    }
  }

  return null
}
