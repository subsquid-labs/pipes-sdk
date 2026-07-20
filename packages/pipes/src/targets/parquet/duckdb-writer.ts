import { unlink } from 'node:fs/promises'

import type { DuckDBAppender, DuckDBConnection } from '@duckdb/node-api'

import {
  DEFAULT_DUCKDB_MEMORY_LIMIT,
  DEFAULT_DUCKDB_THREADS,
  type ParquetDuckdbSettings,
  acquireDuckdbInstance,
  loadDuckdbApi,
} from './duckdb-engine.js'
import {
  buildCreateTableSql,
  buildRowAppender,
  escapeSqlString,
  quoteIdent,
  validateDuckdbTableCompression,
} from './duckdb-schema.js'
import type { ParquetEngine } from './engine.js'
import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import type { Codec, ParquetColumns } from './schema.js'
import { type PublishedSegment, type SegmentWriter, finalizeSegmentFile, nextTmpPath } from './segment.js'

type Row = Record<string, unknown>

/** First-segment fallback before any real bytes/row measurement exists (see the estimator). */
export const DEFAULT_ESTIMATED_BYTES_PER_ROW = 512

/**
 * Rolling bytes-per-row calibration for ONE table. DuckDB stages a segment in memory and only
 * materializes the file at publish (COPY), so — unlike the parquetjs engine — there is no
 * growing temp file to `stat` for byte-based rotation. The store shares one estimator per
 * table across successive writers: each publish records the real bytes/row, and the next
 * segment's `size()` extrapolates from it. The first segment uses a deliberately conservative
 * default: overestimating bytes/row rotates early and bounds staging memory, and the very next
 * segment self-corrects.
 */
export class SegmentSizeEstimator {
  #bytesPerRow = DEFAULT_ESTIMATED_BYTES_PER_ROW

  record(bytes: number, rows: number): void {
    if (rows > 0 && bytes > 0) this.#bytesPerRow = bytes / rows
  }

  estimate(rows: number): number {
    return Math.ceil(rows * this.#bytesPerRow)
  }
}

// Process-unique staging table names — writers share one DuckDB instance and must never collide.
let tableSeq = 0

/** The duckdb engine handle: a {@link ParquetEngine} whose resolved settings are inspectable. */
export type DuckdbEngine = ParquetEngine & { readonly settings: Required<ParquetDuckdbSettings> }

/**
 * DuckDB-backed engine: stages rows in an in-memory DuckDB table and COPYs each segment to
 * Parquet natively, moving encoding/compression/statistics onto DuckDB worker threads.
 * Requires the optional peer dependency `@duckdb/node-api`, loaded lazily on the first
 * segment open. Identical settings share one process-wide DuckDB instance.
 */
export function duckdbEngine(settings?: ParquetDuckdbSettings): DuckdbEngine {
  const resolved = {
    threads: settings?.threads ?? DEFAULT_DUCKDB_THREADS,
    memoryLimit: settings?.memoryLimit ?? DEFAULT_DUCKDB_MEMORY_LIMIT,
  }

  return {
    name: 'duckdb',
    settings: resolved,
    table(table, context) {
      validateDuckdbTableCompression(table, context.codec)

      // Bytes/row calibration survives across this table's successive segments (rotation memory).
      const estimator = new SegmentSizeEstimator()

      return {
        createSegment: () =>
          new DuckdbSegmentWriter({
            dir: context.dir,
            columns: table.schema,
            rowGroupSize: context.rowGroupSize,
            codec: context.codec,
            duckdb: resolved,
            estimator,
          }),
      }
    },
  }
}

export type DuckdbSegmentWriterOptions = {
  /** The table's directory: `<baseDir>/<table>`. Created by the state layer before writes. */
  dir: string
  /** Declared SDK column model. Rows arrive UN-wrapped (plain arrays/objects). */
  columns: ParquetColumns
  /** Rows per row group, forwarded to COPY's ROW_GROUP_SIZE. */
  rowGroupSize: number
  /** File-level compression codec, forwarded to COPY's COMPRESSION. */
  codec: Codec
  /** Engine tuning; identical settings share one process-wide instance. */
  duckdb?: ParquetDuckdbSettings
  /** Shared per-table size calibration (owned by the store, outlives this writer). */
  estimator: SegmentSizeEstimator
}

/**
 * DuckDB-backed {@link SegmentWriter}: appends rows into an in-memory staging table
 * (`CREATE TABLE seg_<n>` on the shared instance, lazily on the first row) and publishes via
 * `COPY seg_<n> TO '<tmpPath>' (FORMAT PARQUET, ...)` followed by the same fsync →
 * collision-check → rename tail as the parquetjs engine. Encoding, compression and statistics
 * run on DuckDB's worker threads — the JS thread only pays appender calls.
 *
 * Crash semantics are preserved: an interrupted COPY leaves only a `.tmp-*` file, which
 * startup recovery already deletes. The staging table is dropped on publish AND discard (and
 * on a failed open), so the shared instance never accumulates state across segments.
 */
export class DuckdbSegmentWriter implements SegmentWriter {
  readonly #dir: string
  readonly #columns: ParquetColumns
  readonly #rowGroupSize: number
  readonly #codec: Codec
  readonly #duckdb: ParquetDuckdbSettings | undefined
  readonly #estimator: SegmentSizeEstimator
  readonly #tmpPath: string
  readonly #tableName = `seg_${(tableSeq++).toString().padStart(6, '0')}`

  #connection: DuckDBConnection | undefined
  #appender: DuckDBAppender | undefined
  #writeRow: ((row: Row) => void) | undefined
  #rowCount = 0
  #minBlock: number | undefined
  #maxBlock: number | undefined
  #closed = false

  constructor(options: DuckdbSegmentWriterOptions) {
    this.#dir = options.dir
    this.#columns = options.columns
    this.#rowGroupSize = options.rowGroupSize
    this.#codec = options.codec
    this.#duckdb = options.duckdb
    this.#estimator = options.estimator
    this.#tmpPath = nextTmpPath(options.dir)
  }

  get isOpen(): boolean {
    return this.#connection !== undefined
  }

  get rowCount(): number {
    return this.#rowCount
  }

  get minBlock(): number | undefined {
    return this.#minBlock
  }

  get maxBlock(): number | undefined {
    return this.#maxBlock
  }

  /** Appends one row, lazily creating the staging table + appender on first use. */
  async appendRow(row: Row, blockNumber: number): Promise<void> {
    if (!this.#writeRow) await this.#open()

    this.#writeRow!(row)

    this.#rowCount++
    if (this.#minBlock === undefined || blockNumber < this.#minBlock) this.#minBlock = blockNumber
    if (this.#maxBlock === undefined || blockNumber > this.#maxBlock) this.#maxBlock = blockNumber
  }

  /**
   * Estimated output size. No file exists before COPY, so this extrapolates rowCount × bytes/row
   * from the table's previously published segments (or a conservative default for the first).
   * Byte rotation is therefore approximate — `rollover.maxBytes` was always a soft,
   * batch-boundary target — while `maxRows`/`intervalMs`/`intervalBlocks` remain exact.
   */
  async size(): Promise<number> {
    if (!this.#connection) return 0

    return this.#estimator.estimate(this.#rowCount)
  }

  async publish(): Promise<PublishedSegment> {
    if (!this.#connection || !this.#appender || this.#minBlock === undefined || this.#maxBlock === undefined) {
      throw new ParquetTargetError(
        PARQUET_ERROR_CODES.FILE_COLLISION,
        `Internal: publish() called on an empty segment in '${this.#dir}'. Only segments with ` +
          `at least one row may be published.`,
      )
    }

    const connection = this.#connection
    this.#appender.flushSync()
    this.#appender.closeSync()
    this.#appender = undefined
    this.#writeRow = undefined

    try {
      await connection.run(
        `COPY ${quoteIdent(this.#tableName)} TO '${escapeSqlString(this.#tmpPath)}' ` +
          `(FORMAT PARQUET, COMPRESSION ${this.#codec}, ROW_GROUP_SIZE ${this.#rowGroupSize})`,
      )
    } finally {
      // Always drop the staging table and release the connection, even on a failed COPY — the
      // shared instance outlives this writer and must not accumulate segment tables.
      await this.#dropStagingTable(connection)
      this.#closed = true
      this.#connection = undefined
      connection.disconnectSync()
    }

    const published = await finalizeSegmentFile({
      dir: this.#dir,
      tmpPath: this.#tmpPath,
      rows: this.#rowCount,
      minBlock: this.#minBlock,
      maxBlock: this.#maxBlock,
    })
    this.#estimator.record(published.bytes, published.rows)

    return published
  }

  /**
   * Best-effort cleanup of an unpublished segment: closes the appender without flushing
   * semantics we care about (the table is dropped anyway), drops the staging table, releases
   * the connection and unlinks the temp file. The discarded rows are finalized-but-not-
   * checkpointed and regenerate from the portal on the next run. Safe to call twice.
   */
  async discard(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true
      try {
        this.#appender?.closeSync()
      } catch {
        // best-effort — the appender may already be closed or mid-flush on the error path
      }
      if (this.#connection) {
        await this.#dropStagingTable(this.#connection)
        this.#connection.disconnectSync()
      }
    }
    this.#appender = undefined
    this.#connection = undefined
    this.#writeRow = undefined

    try {
      await unlink(this.#tmpPath)
    } catch {
      // best-effort — the temp file may not exist yet (COPY never ran) or already be gone
    }
  }

  async #open(): Promise<void> {
    const api = await loadDuckdbApi()
    const instance = await acquireDuckdbInstance(this.#duckdb)
    const connection = await instance.connect()

    try {
      await connection.run(buildCreateTableSql(this.#tableName, this.#columns))
      const appender = await connection.createAppender(this.#tableName)
      this.#writeRow = buildRowAppender(api, this.#columns)(appender)
      this.#appender = appender
      this.#connection = connection
    } catch (error) {
      // A half-open writer must not leak its table into the shared instance.
      await this.#dropStagingTable(connection)
      connection.disconnectSync()
      throw error
    }
  }

  async #dropStagingTable(connection: DuckDBConnection): Promise<void> {
    try {
      await connection.run(`DROP TABLE IF EXISTS ${quoteIdent(this.#tableName)}`)
    } catch {
      // best-effort — an unreachable instance means the process is going down anyway
    }
  }
}
