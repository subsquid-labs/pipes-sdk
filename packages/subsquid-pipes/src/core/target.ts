import { PortalBatch } from './portal-source.js'
import { BlockCursor, Ctx } from './types.js'

export type Target<In> = {
  write: (writer: { read: (cursor?: BlockCursor) => AsyncIterableIterator<PortalBatch<In>>; ctx: Ctx }) => Promise<void>
  fork?: (previousBlocks: BlockCursor[]) => Promise<BlockCursor | null>
}

export function createTarget<In>(options: Target<In>): Target<In> {
  return options
}
