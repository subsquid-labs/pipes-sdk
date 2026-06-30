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
        // The source has already clamped finalized + rollbackChain through the pipe's
        // monotonic finalized watermark, so a regressed/transiently-missing head can
        // never un-finalize emitted data — the buffer releases rows directly.
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
