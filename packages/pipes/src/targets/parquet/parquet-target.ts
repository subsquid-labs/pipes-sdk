import {
  type BlockCursor,
  type Counter,
  type Finalization,
  type Histogram,
  type HookContext,
  type Logger,
  type Metrics,
  createTarget,
  formatBlock,
  formatNumber,
  humanBytes,
} from '~/core/index.js'

import { type ParquetEngine, type ParquetEngineName, resolveEngine } from './engine.js'
import { ParquetState } from './parquet-state.js'
import { ParquetStore } from './parquet-store.js'
import { type Codec, type ParquetTable, validateTables } from './schema.js'

/** Default rollover byte size — 128 MiB is a good Parquet file size for data-lake query engines. */
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024
/** Default rows per row group — the in-memory "split size" that bounds writer memory. */
const DEFAULT_ROW_GROUP_SIZE = 100_000
const DEFAULT_CODEC: Codec = 'SNAPPY'

export type ParquetRollover = {
  /** Soft byte cap per file — checked at each batch boundary, so a huge batch can overshoot. Default 128 MiB. */
  maxBytes?: number
  /** Optional row cap per file, checked alongside `maxBytes`. */
  maxRows?: number
  /** Optional wall-clock checkpoint floor (ms) — recommended for live tailing so finalized data isn't stuck in an open file. */
  intervalMs?: number
  /** Optional block-count checkpoint floor — checkpoint once the cursor advances this many blocks. */
  intervalBlocks?: number
}

export type ParquetSettings = {
  rollover?: ParquetRollover
  /** Rows per row group — bounds writer memory. Default 100_000. */
  rowGroupSize?: number
  /** Default per-column compression. Default `'SNAPPY'`. */
  compression?: Codec
  /**
   * Segment writer engine. `'parquetjs'` (default) and `'duckdb'` select the built-in engines
   * with default settings; pass an engine instance — `parquetjsEngine()`, `duckdbEngine({...})`,
   * or any own {@link ParquetEngine} implementation — to tune or extend. The `'duckdb'` engine
   * produces value-identical files with slightly different footer metadata (every field is
   * written OPTIONAL, integer columns gain INT_64/INT_32 annotations, and timestamps
   * additionally carry a modern `isAdjustedToUTC=false` logical type next to the same legacy
   * TIMESTAMP_MILLIS annotation). Its byte-based rotation is an estimate calibrated from
   * previously published segments; row/interval rollovers stay exact.
   */
  engine?: ParquetEngine | ParquetEngineName
  /**
   * Namespace for the state file, so multiple pipes can share one `dir`. Defaults to the
   * pipe's source `id`; set explicitly only to pin the state file independent of the source id.
   */
  id?: string
}

type ParquetTargetMetrics = {
  rowsWritten: Counter<'id' | 'table'>
  bytesWritten: Counter<'id' | 'table'>
  filesPublished: Counter<'id' | 'table'>
  checkpointDuration: Histogram<'id'>
}

/**
 * Writes a stream to rotating, **finalized-only** Parquet files — the columnar format read by
 * DuckDB, Spark, Athena and ClickHouse's `s3()`.
 *
 * **Finalized-only.** Parquet files are immutable once written, so a block that could still
 * reorg is never written. Each table buffers unfinalized rows in memory (via the shared
 * {@link finalizationBuffer}) and only appends a row once its block is at or below the
 * portal's finalized head. A reorg drops the in-memory buffer; published files are never touched.
 *
 * **Constant memory.** Finalized rows stream straight to a temp file and the file rotates by byte
 * size, so a multi-gigabyte finalized backfill never lands wholly in RAM (`@dsnp/parquetjs`
 * flushes row groups to disk incrementally — verified by the Step 0 spike). `rowGroupSize` bounds
 * the writer's in-memory buffer.
 *
 * **Crash safety.** A writer holding ≥1 finalized row is always published at the very next
 * checkpoint, and the persisted cursor advances only at a checkpoint — so no finalized row is ever
 * held past the cursor. On restart, recovery deletes any published file above the cursor (an
 * incomplete checkpoint) and any temp file, then `read(cursor)` re-fetches the deterministic,
 * finalized data after the cursor, which regenerates identically.
 *
 * **Contract (load-bearing): `onData` must be a pure function of the batch for finalized blocks.**
 * Recovery re-processes finalized blocks after a crash and relies on regenerating byte-identical
 * rows. Do not let wall-clock time, RNG, or external mutable state affect a row's identity. Unlike
 * BigQuery (which dedupes server-side via committed-stream offsets), Parquet has no server-side
 * dedupe, so this purity contract is the recovery guarantee.
 *
 * Known trade-offs:
 * - One busy table's checkpoint rotates **all** open writers, so low-volume tables get smaller
 *   files (the "small files" problem) — inherent to a single global cursor.
 * - Byte-only rotation can stall the cursor on a slow live tail (finalized data stays invisible
 *   until the file closes; a crash re-fetches more). Set `rollover.intervalMs`/`intervalBlocks`
 *   for live tailing.
 * - A **no-finality dataset has no finalized head**, so the threshold is `Infinity` and every row
 *   is written immediately: the files are **not reorg-safe**, and if such a chain forks the pipe
 *   goes fatal (same as the memory target).
 *
 * @param options.dir - Output directory. It is the isolation unit — **one pipe per dir**. Holds a
 *   `<table>/` sub-directory per table plus a `_sqd_parquet_state.<pipe-id>.json` cursor file
 *   (namespaced by the pipe's source id, or by `settings.id` when set explicitly).
 * @param options.tables - Declared tables with explicit schemas; the block-number column must be
 *   present and integer-typed. Writing to an undeclared table from `onData` throws.
 * @param options.onData - Per-batch handler; call `store.insert(table, rows)` to stage rows.
 */
export function parquetTarget<T>(options: {
  dir: string
  tables: ParquetTable[]
  settings?: ParquetSettings
  onStart?: (ctx: { store: ParquetStore; logger: Logger }) => Promise<unknown> | unknown
  onData: (ctx: { store: ParquetStore; data: T; ctx: HookContext }) => Promise<unknown> | unknown
}) {
  const { dir, tables, settings = {}, onStart, onData } = options

  validateTables(tables)

  // Resolving the engine (and, inside the store constructor, its per-table capability checks)
  // runs at construction, so config mistakes surface at startup, not deep in the first batch.
  const engine = resolveEngine(settings.engine)

  const rowGroupSize = settings.rowGroupSize ?? DEFAULT_ROW_GROUP_SIZE
  const defaultCodec = settings.compression ?? DEFAULT_CODEC

  const maxBytes = settings.rollover?.maxBytes ?? DEFAULT_MAX_BYTES
  const { maxRows, intervalMs, intervalBlocks } = settings.rollover ?? {}

  const store = new ParquetStore({ dir, tables, rowGroupSize, defaultCodec, engine })

  return createTarget<T>({
    write: async ({ read, logger, id }) => {
      // Lazy: registered on the first batch from `ctx.metrics`.
      let metrics: ParquetTargetMetrics | undefined

      // Namespace the state file by the pipe's source id (an explicit settings.id wins), so
      // several pipes can share one dir without clobbering each other's cursor.
      const state = new ParquetState({ dir, tables: tables.map((t) => t.table), id: settings.id ?? id, logger })

      // Tracks checkpoint progress; the closure below mutates it.
      let lastCheckpointMs = Date.now()
      let lastCheckpointBlock = -1

      // The try/finally wraps the ENTIRE write() body, so a startup throw still discards any open
      // temp files. fork() runs inside read()'s generator while this for-await is suspended, so no
      // write races with it and close-in-finally is race-free.
      try {
        const resumeState = await state.getCursor()
        const startCursor = resumeState?.latest
        lastCheckpointBlock = startCursor?.number ?? -1

        await onStart?.({ store, logger })

        // Captured for the checkpoint closure's metric labels — assigned on the first batch.
        let metricsId = ''
        let lastBoundary: BlockCursor | undefined = startCursor
        // Latest (source-clamped) finalized head, persisted alongside the cursor at each checkpoint
        // so the source can re-seed its watermark after an unclean restart. Seeded from resume state.
        let lastFinalized: BlockCursor | undefined = resumeState?.finalized ?? undefined

        const checkpoint = async (cursor: BlockCursor | undefined, reason: string): Promise<void> => {
          const startedMs = Date.now()
          const published = await store.publishAll()
          if (cursor) await state.saveCursor(cursor, lastFinalized)

          if (metrics) {
            for (const file of published) {
              metrics.bytesWritten.inc({ id: metricsId, table: file.table }, file.bytes)
              metrics.filesPublished.inc({ id: metricsId, table: file.table }, 1)
            }
            metrics.checkpointDuration.observe({ id: metricsId }, (Date.now() - startedMs) / 1000)
          }

          lastCheckpointMs = Date.now()
          if (cursor) lastCheckpointBlock = cursor.number

          if (published.length > 0) {
            const rows = published.reduce((s, f) => s + f.rows, 0)
            const bytes = published.reduce((s, f) => s + f.bytes, 0)
            logger.info({
              message: `checkpoint (${reason}): published ${published.length} file(s), ${formatNumber(rows)} rows / ${humanBytes(bytes)}${cursor ? `, cursor → block ${formatBlock(cursor.number)}` : ''}`,
              files: published.map((f) => f.path),
            })
          } else if (cursor) {
            logger.debug(`checkpoint (${reason}): no open files, cursor → block ${formatBlock(cursor.number)}`)
          }
        }

        for await (const { data, ctx } of read(resumeState)) {
          if (!metrics) {
            metrics = registerParquetMetrics(ctx.metrics)
            metricsId = ctx.id
          }

          // 1. user stages rows via store.insert(...)
          await onData({ store, data, ctx: { logger, profiler: ctx.profiler } })

          // 2. finalization + the cursor this batch could checkpoint to. The boundary carries the
          //    HASH needed for resume; boundary.number = min(finalized, current), correct for
          //    backfill / tip / no-finality / straddling batches. `finalized` is already clamped by
          //    the source, so it never regresses — persist it as the restart-seed floor.
          const finalized = ctx.stream.head.finalized
          if (finalized) {
            lastFinalized = finalized
          }
          const current = ctx.stream.state.current
          const finalization: Finalization = { finalized, rollbackChain: ctx.stream.state.rollbackChain }
          const boundaryCursor = finalized && finalized.number <= current.number ? finalized : current
          lastBoundary = boundaryCursor

          // 3. release finalized rows into the (lazily-opened) writers.
          const appended = await store.flushBatch(finalization)
          for (const stat of appended) {
            metrics.rowsWritten.inc({ id: ctx.id, table: stat.table }, stat.rows)
          }

          // 4. checkpoint on any rollover trigger.
          const reasons: string[] = []
          if (await store.shouldRotate({ maxBytes, maxRows })) reasons.push('size')
          if (intervalMs !== undefined && Date.now() - lastCheckpointMs >= intervalMs) reasons.push('interval-ms')
          if (intervalBlocks !== undefined && boundaryCursor.number - lastCheckpointBlock >= intervalBlocks) {
            reasons.push('interval-blocks')
          }

          if (reasons.length > 0) await checkpoint(boundaryCursor, reasons.join('+'))
        }

        // 5. stream end — flush any open writers and persist the final cursor.
        if (lastBoundary !== undefined && (store.hasOpenWriters || lastBoundary.number > lastCheckpointBlock)) {
          await checkpoint(lastBoundary, 'stream-end')
        }
      } finally {
        await store.close()
      }
    },

    // Reorg: drop buffered (unfinalized) rows above the safe cursor across every table buffer.
    // Published files and open writers hold only finalized rows, so they are never rolled back.
    resolveFork: (canonicalBlocks) => store.resolveFork(canonicalBlocks),
  })
}

function registerParquetMetrics(metrics: Metrics): ParquetTargetMetrics {
  // Sub-second checkpoints on a healthy pipeline up to tens of seconds when a large file is being
  // closed + fsynced; the long tail beyond 30s lands in +Inf.
  const checkpointBuckets = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30]

  return {
    rowsWritten: metrics.counter({
      name: 'sqd_parquet_rows_written_total',
      help: 'Finalized rows appended to Parquet writers, by table.',
      labelNames: ['id', 'table'] as const,
    }),
    bytesWritten: metrics.counter({
      name: 'sqd_parquet_bytes_written_total',
      help: 'Bytes of published Parquet files, by table (on-disk size including footer).',
      labelNames: ['id', 'table'] as const,
    }),
    filesPublished: metrics.counter({
      name: 'sqd_parquet_files_published_total',
      help: 'Parquet files published (closed + atomically renamed), by table.',
      labelNames: ['id', 'table'] as const,
    }),
    checkpointDuration: metrics.histogram({
      name: 'sqd_parquet_checkpoint_duration_seconds',
      help: 'Wallclock duration (seconds) of one checkpoint (publish open files + persist cursor).',
      labelNames: ['id'] as const,
      buckets: checkpointBuckets,
    }),
  }
}
