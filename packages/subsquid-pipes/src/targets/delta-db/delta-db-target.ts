import { DeltaBatch, DeltaDb } from '@sqd-pipes/delta-db'

import { BlockCursor, createTarget } from '~/core/index.js'

export type Row = Record<string, any>

export interface DeltaDbTargetOptions<TInput = Record<string, any[]>> {
  /** SQL schema definition (CREATE TABLE, CREATE REDUCER, CREATE MATERIALIZED VIEW). */
  schema: string
  /** RocksDB data directory. Enables persistence and resumption. */
  dataDir?: string
  /** Maximum delta buffer size before backpressure. Default: 10000. */
  maxBufferSize?: number
  /**
   * Map decoder output to schema tables.
   * Returns Record<string, Row[]> where keys are table names from the schema.
   * Rows must contain `block_number`.
   * If omitted, data is passed through directly (keys must match table names).
   */
  transform?: (data: TInput) => Record<string, Row[]>
  /**
   * Called with each delta batch (including rollback compensating deltas).
   * Apply records to your downstream store.
   */
  onDelta: (ctx: { batch: DeltaBatch; ctx: any }) => unknown | Promise<unknown>
}

/**
 * Creates a Pipes SDK Target that routes decoded blockchain data
 * through Delta DB's computation pipeline (raw tables → reducers → MVs)
 * and flushes delta batches to a downstream store.
 *
 * Each iteration is atomic — `db.ingest()` processes all tables, stores
 * block hashes, finalizes, and flushes in a single RocksDB WriteBatch.
 */
export function deltaDbTarget<T = Record<string, any[]>>({
  schema,
  dataDir,
  maxBufferSize = 1_000_000,
  transform,
  onDelta,
}: DeltaDbTargetOptions<T>) {
  const db = DeltaDb.open({
    schema,
    dataDir,
    maxBufferSize,
  })

  return createTarget<T>({
    write: async ({ read }) => {
      for await (const { data, ctx } of read(db.cursor ?? undefined)) {
        const span = ctx.profiler.start('delta-db')
        const mapped = span.measureSync('transform', () => {
          return transform ? transform(data) : (data as Record<string, any[]>)
        })

        const batch = span.measureSync('ingest', () => {
          if (!ctx.stream.head.finalized) {
            throw new Error('ctx.stream.finalized is required — source must provide finalization info')
          }

          return db.ingest({
            data: mapped,
            rollbackChain: ctx.stream.state.rollbackChain,
            finalizedHead: ctx.stream.head.finalized,
          })
        })

        if (batch) {
          await span.measure('downstream', async () => {
            await onDelta({
              batch,
              ctx,
            })
          })

          span.measureSync('ack', () => {
            db.ack(batch.sequence)
          })
        }

        span.end()
      }
    },
    fork: async (previousBlocks): Promise<BlockCursor | null> => {
      if (!previousBlocks || !previousBlocks?.length) return null

      const forkCursor = db.resolveForkCursor(previousBlocks)
      if (!forkCursor) {
        throw new Error('Fork too deep: no common ancestor found in block hashes')
      }

      db.rollback(forkCursor.number)

      const batch = db.flush()
      if (batch) {
        await onDelta({ batch, ctx: null })
        db.ack(batch.sequence)
      }

      return forkCursor
    },
  })
}
