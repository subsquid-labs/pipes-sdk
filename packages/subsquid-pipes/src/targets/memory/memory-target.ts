import { BlockCursor, createTarget, resolveForkCursor } from '~/core/index.js'

function arraySplit<T>(array: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const pass: T[] = []
  const fail: T[] = []

  if (!array.length) {
    return [pass, fail]
  }

  for (const item of array) {
    if (predicate(item)) {
      pass.push(item)
    } else {
      fail.push(item)
    }
  }

  return [pass, fail]
}

export function createMemoryTarget<T extends { blockNumber: number }[]>({
  onData,
}: {
  onData: (data: T) => Promise<void> | void
}) {
  let recentUnfinalizedBlocks: BlockCursor[] = []
  let unfinalizedData: T[number][] = []
  let finalizedHead: BlockCursor | undefined

  return createTarget<T>({
    write: async ({ read }) => {
      for await (const batch of read()) {
        recentUnfinalizedBlocks.push(...batch.ctx.state.rollbackChain)
        finalizedHead = batch.ctx.head.finalized

        const finalizedNumber = finalizedHead?.number || Infinity

        const [finalized, newUnfinalized] = arraySplit(batch.data, (item) => item.blockNumber <= finalizedNumber)

        if (finalized.length) {
          await onData(finalized as T)
        }

        const [newFinalizedData, stillUnfinalizedData] = arraySplit(
          unfinalizedData,
          (item) => item.blockNumber <= finalizedNumber,
        )
        if (newFinalizedData.length) {
          await onData(newFinalizedData as T)
        }

        unfinalizedData = [...stillUnfinalizedData, ...newUnfinalized]
      }
    },

    fork: async (previousBlocks) => {
      const safeCursor = await resolveForkCursor(
        [{ rollbackChain: recentUnfinalizedBlocks, finalized: finalizedHead }],
        previousBlocks,
      )

      if (safeCursor) {
        recentUnfinalizedBlocks = recentUnfinalizedBlocks.filter((b) => b.number <= safeCursor.number)
        unfinalizedData = unfinalizedData.filter((item) => item.blockNumber <= safeCursor.number)
      } else {
        recentUnfinalizedBlocks = []
      }

      return safeCursor
    },
  })
}
