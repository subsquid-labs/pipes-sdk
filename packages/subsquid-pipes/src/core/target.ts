import { Logger } from '~/core/logger.js'
import { RunnerCtx } from '~/runner/runner.js'

import { PortalBatch } from './portal-source.js'
import { BlockCursor } from './types.js'

export type Target<In> = {
  write: (writer: {
    read: (cursor?: BlockCursor) => AsyncIterableIterator<PortalBatch<In>>
    logger: Logger
    runnerCtx?: RunnerCtx
  }) => Promise<void>
  fork?: (previousBlocks: BlockCursor[]) => Promise<BlockCursor | null>
}

export function createTarget<In>(options: Target<In>): Target<In> {
  return options
}
