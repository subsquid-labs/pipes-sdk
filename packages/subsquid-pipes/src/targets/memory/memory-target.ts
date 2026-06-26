import { createFinalizationBuffer, createTarget } from '~/core/index.js'

export function createMemoryTarget<T extends { blockNumber: number }[]>({
  onData,
}: {
  onData: (data: T) => Promise<void> | void
}) {
  const buffer = createFinalizationBuffer<T[number]>({
    getBlockNumber: (row) => row.blockNumber,
  })

  return createTarget<T>({
    write: async ({ read }) => {
      for await (const batch of read()) {
        const finalized = buffer.push(batch.data, {
          finalized: batch.ctx.stream.head.finalized,
          rollbackChain: batch.ctx.stream.state.rollbackChain,
        })

        if (finalized.length) {
          await onData(finalized as T)
        }
      }
    },

    fork: (previousBlocks) => buffer.fork(previousBlocks),
  })
}
