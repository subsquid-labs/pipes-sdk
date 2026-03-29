import { DeltaBatch, DeltaDb, type DeltaDbCursor, type IngestInput } from '@sqd-pipes/delta-db'

import { BlockCursor, createTarget } from '~/core/index.js'

export type Row = Record<string, any>

export type { DeltaBatch } from '@sqd-pipes/delta-db'

export interface DeltaDbLike {
  ingest(input: IngestInput): Promise<DeltaBatch | null>
  handleFork(previousBlocks: DeltaDbCursor[]): Promise<{ cursor: DeltaDbCursor; batch: DeltaBatch | null }>
  flush(): DeltaBatch | null
  ack(sequence: number): void
  get cursor(): DeltaDbCursor | null
}

export interface DeltaDbTargetOptions<TInput = Record<string, any[]>> {
  /** SQL schema definition (CREATE TABLE, CREATE REDUCER, CREATE MATERIALIZED VIEW). */
  schema: string
  /** RocksDB data directory. Enables persistence and resumption. */
  dataDir?: string
  /** Maximum delta buffer size before backpressure. Default: 10000. */
  maxBufferSize?: number
  /** Pre-instantiated DeltaDb instance. When provided, schema/dataDir/maxBufferSize are ignored. */
  db?: DeltaDbLike
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

type PerfNode = { kind: string; name: string; durationMs: number; children: PerfNode[] }

const LABELS = ['delta-db']

function mapPerfChildren(nodes: PerfNode[]): { name: string; elapsed: number; labels: string[]; children: any[] }[] {
  return nodes.map((n) => ({
    name: `${n.kind}:${n.name}`,
    elapsed: n.durationMs,
    labels: LABELS,
    children: mapPerfChildren(n.children),
  }))
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
  db: providedDb,
  transform,
  onDelta,
}: DeltaDbTargetOptions<T>) {
  const db =
    providedDb ??
    DeltaDb.open({
      schema,
      dataDir,
      maxBufferSize,
    })

  return createTarget<T>({
    write: async ({ read }) => {
      for await (const { data, ctx } of read(db.cursor ?? undefined)) {
        if (!ctx.stream.head.finalized) {
          throw new Error('ctx.stream.finalized is required — source must provide finalization info')
        }

        const span = ctx.profiler.start({ name: 'delta-db', labels: LABELS })
        const batch = await db.ingest({
          data: data as Record<string, any[]>,
          rollbackChain: ctx.stream.state.rollbackChain,
          finalizedHead: ctx.stream.head.finalized,
        })

        if (batch) {
          for (const node of batch.perf ?? []) {
            span.import({
              name: node.kind === 'pipeline' ? node.name : `${node.kind}:${node.name}`,
              elapsed: node.durationMs,
              labels: LABELS,
              children: mapPerfChildren(node.children),
            })
          }

          await span.measure('downstream', async () => {
            await onDelta({ batch, ctx })
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

      const { cursor, batch } = await db.handleFork(previousBlocks)

      if (batch) {
        await onDelta({ batch, ctx: null })
        db.ack(batch.sequence)
      }

      return cursor
    },
  })
}
