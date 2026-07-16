import { BlockCursor, formatNumber, joinLines } from '~/core/index.js'

import { last } from '../internal/array.js'

export class ForkException extends Error {
  override readonly name = 'ForkError'

  /**
   * The portal's view of the canonical chain at the fork point
   * (a.k.a. `previousBlocks` from Portal API `/stream` 409 responses).
   */
  readonly canonicalBlocks: BlockCursor[]

  constructor(
    canonicalBlocks: BlockCursor[],
    readonly query: { fromBlock?: number; parentBlockHash?: string },
  ) {
    const parent = last(canonicalBlocks)

    const block = query.fromBlock ? formatNumber(query.fromBlock) : 'last'

    super(
      joinLines([
        `A blockchain fork was detected at ${block} block.`,
        `-----------------------------------------`,
        `The correct hash:        "${parent.hash}".`,
        `But the client provided: "${query.parentBlockHash}".`,
        `-----------------------------------------`,
        `Please refer to the documentation on how to handle forks.`,
      ]),
    )

    this.canonicalBlocks = canonicalBlocks
  }
}

export function isForkException(err: unknown): err is ForkException {
  if (err instanceof ForkException) return true
  if (err instanceof Error && err.name === 'ForkError') return true

  return false
}
