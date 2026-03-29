import { Logger } from '~/core/logger.js'
import { PortalStreamOptions } from '~/portal-client/client.js'

import { PortalBatch } from './portal-source.js'
import { BlockCursor } from './types.js'

export type Target<In> = {
  write: (writer: {
    read: (cursor?: BlockCursor) => AsyncIterableIterator<PortalBatch<In>>
    logger: Logger
  }) => Promise<void>
  fork?: (previousBlocks: BlockCursor[]) => Promise<BlockCursor | null>
  /** Stream options forwarded to the portal when this target is connected via pipeTo(). */
  streamOptions?: PortalStreamOptions
}

export function createTarget<In>(options: Target<In>): Target<In> {
  return options
}
