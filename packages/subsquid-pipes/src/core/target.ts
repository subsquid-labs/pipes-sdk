import { Logger } from '~/core/logger.js'

import { PortalBatch } from './portal-source.js'
import { BlockCursor } from './types.js'

/**
 * Resume state a target hands back to the source when it starts reading.
 *
 * `latest` is the cursor to resume from (the block after it is the first one
 * fetched). `finalized` is the target's own PERSISTED finalized head; the source
 * seeds its monotonic finalized watermark from it so the watermark survives an
 * unclean restart mid-fork. `finalized` is a required key, explicitly `null` when
 * there is no finalized head (no-finality datasets, the memory target, a
 * cold-started target) — the absence must be stated, never just omitted.
 */
export type TargetState = {
  latest: BlockCursor
  finalized: BlockCursor | null
}

export type Target<In> = {
  write: (writer: {
    read: (state?: TargetState) => AsyncIterableIterator<PortalBatch<In>>
    logger: Logger
  }) => Promise<void>
  fork?: (previousBlocks: BlockCursor[]) => Promise<BlockCursor | null>
}

export function createTarget<In>(options: Target<In>): Target<In> {
  return options
}
