import { type MockPortal, type MockResponse, createMockPortal } from '../test-portal.js'
import { type PortalBlock } from './mock-block.js'

/**
 * Creates a mock portal HTTP server that serves the given blocks as a stream response.
 *
 * @example
 * ```ts
 * const event1 = encodeEvent({ abi, eventName: 'Transfer', address, args: { ... } })
 *
 * const portal = await evmPortalMockStream({
 *   blocks: [
 *     mockBlock({ transactions: [{ logs: [event1] }] }),
 *     mockBlock({ transactions: [{ logs: [event1] }] }),
 *   ],
 * })
 * ```
 */
export async function evmPortalMockStream({
  blocks,
  finalized,
}: {
  blocks: PortalBlock[]
  finalized?: { number: number; hash: string }
}): Promise<MockPortal> {
  const lastBlock = blocks[blocks.length - 1]
  const head = finalized ?? (lastBlock ? { number: lastBlock.header.number, hash: lastBlock.header.hash } : undefined)

  const response: MockResponse = {
    statusCode: 200,
    data: blocks,
    head: head ? { finalized: head } : undefined,
  }

  return createMockPortal([response])
}
