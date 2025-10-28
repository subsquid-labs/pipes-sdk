import { BlockCursor, createTarget } from '~/core/index.js'

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

function findRollbackIndex(chainA: BlockCursor[], chainB: BlockCursor[]): number {
  let aIndex = 0
  let bIndex = 0
  let lastCommonIndex = -1

  while (aIndex < chainA.length && bIndex < chainB.length) {
    const blockA = chainA[aIndex]
    const blockB = chainB[bIndex]

    if (blockA.number < blockB.number) {
      aIndex++
      continue
    }

    if (blockA.number > blockB.number) {
      bIndex++
      continue
    }

    if (blockA.number === blockB.number && blockA.hash !== blockB.hash) {
      return lastCommonIndex
    }

    lastCommonIndex = aIndex
    aIndex++
    bIndex++
  }

  return lastCommonIndex
}

export function createMemoryTarget<T extends { blockNumber: number }[]>({
  onData,
}: {
  onData: (data: T) => Promise<void> | void
}) {
  let recentUnfinalizedBlocks: BlockCursor[] = []
  let unfinalizedData: T[number][] = []

  return createTarget<T>({
    write: async ({ read }) => {
      for await (const batch of read()) {
        recentUnfinalizedBlocks.push(...batch.ctx.state.rollbackChain)
        const finalizedHead = batch.ctx.head.finalized?.number || Infinity

        const [finalized, newUnfinalized] = arraySplit(batch.data, (item) => item.blockNumber <= finalizedHead)

        if (finalized.length) {
          await onData(finalized as T)
        }

        const [newFinalizedData, stillUnfinalizedData] = arraySplit(
          unfinalizedData,
          (item) => item.blockNumber <= finalizedHead,
        )
        if (newFinalizedData.length) {
          await onData(newFinalizedData as T)
        }

        unfinalizedData = [...stillUnfinalizedData, ...newUnfinalized]
      }
    },

    fork: async (previousBlocks) => {
      const rollbackIndex = findRollbackIndex(recentUnfinalizedBlocks, previousBlocks)

      if (rollbackIndex >= 0) {
        const rollbackBlock = recentUnfinalizedBlocks[rollbackIndex]

        recentUnfinalizedBlocks = recentUnfinalizedBlocks.slice(0, rollbackIndex + 1)
        unfinalizedData = unfinalizedData.filter((item) => item.blockNumber <= rollbackBlock.number)

        return rollbackBlock
      }

      recentUnfinalizedBlocks = []
      return null
    },
  })
}
