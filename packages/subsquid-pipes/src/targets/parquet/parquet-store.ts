import path from 'node:path'

import { ParquetSchema } from '@dsnp/parquetjs'

import { type BlockCursor, type Finalization, type FinalizationBuffer, createFinalizationBuffer } from '~/core/index.js'

import { PQ_ERR, ParquetTargetError } from './errors.js'
import { type Codec, type ParquetTable, blockColumnOf, toParquetSchemaShape } from './schema.js'
import { ParquetSegmentWriter, type PublishedSegment } from './writer.js'

type Row = Record<string, unknown>

/** Per-table immutable config resolved once at construction. */
type TableConfig = {
  blockColumn: string
  schema: ParquetSchema
  dir: string
}

/** Rotation thresholds checked at each batch boundary. */
export type RotationLimits = {
  maxBytes: number
  maxRows?: number
}

/** Per-table count of rows appended in a `flushBatch` call (for metrics). */
export type AppendStat = { table: string; rows: number }

/**
 * Staging + per-table finalization buffers + open segment writers for the Parquet target.
 *
 * `insert(table, rows)` stages a batch's rows (rejecting unknown tables synchronously, like
 * `bigquery-store`). `flushBatch` folds each table's staged rows through its
 * {@link FinalizationBuffer} and appends the released (finalized) rows to that table's open
 * segment writer — opening a writer lazily only when there is at least one finalized row, so
 * empty/low-volume tables never create degenerate files.
 *
 * Every declared table's buffer is advanced on every batch (even with no staged rows) so that
 * (a) low-volume tables still release previously-buffered rows once a later finalized head passes
 * them, and (b) every buffer carries the same rollback chain for fork resolution.
 */
export class ParquetStore {
  readonly #configs = new Map<string, TableConfig>()
  readonly #buffers = new Map<string, FinalizationBuffer<Row>>()
  readonly #staged = new Map<string, Row[]>()
  // The current open segment per table — at most one. Reset (published/discarded) at checkpoints.
  readonly #writers = new Map<string, ParquetSegmentWriter>()
  readonly #rowGroupSize: number

  constructor(options: { dir: string; tables: ParquetTable[]; rowGroupSize: number; defaultCodec: Codec }) {
    this.#rowGroupSize = options.rowGroupSize

    for (const table of options.tables) {
      const blockColumn = blockColumnOf(table)
      this.#configs.set(table.table, {
        blockColumn,
        schema: new ParquetSchema(toParquetSchemaShape(table, options.defaultCodec)),
        dir: path.join(options.dir, table.table),
      })
      this.#buffers.set(
        table.table,
        createFinalizationBuffer<Row>({ getBlockNumber: (row) => Number(row[blockColumn]) }),
      )
    }
  }

  /**
   * Stages rows for `table` until the next `flushBatch`. Throws synchronously if `table` was not
   * declared in `tables[]` — an unknown table can never be finalized, rotated or recovered, so
   * surfacing it immediately (before any I/O) is safer than silently dropping the rows.
   */
  insert(table: string, rows: Row[]): void {
    if (!this.#configs.has(table)) {
      throw new ParquetTargetError(
        PQ_ERR.UNREGISTERED_TABLE,
        `Table '${table}' is not declared. Declared tables: ${[...this.#configs.keys()].sort().join(', ')}. ` +
          `Add it to parquetTarget({ tables: [...] }).`,
      )
    }
    if (rows.length === 0) return

    const existing = this.#staged.get(table)
    if (existing) {
      existing.push(...rows)
    } else {
      this.#staged.set(table, [...rows])
    }
  }

  /**
   * Advances every table's finalization buffer with this batch's staged rows + finalization
   * state, appends the now-finalized rows to each table's (lazily-opened) segment writer, and
   * clears staging. Returns per-table appended-row counts for metrics.
   */
  async flushBatch(finalization: Finalization): Promise<AppendStat[]> {
    const stats: AppendStat[] = []

    for (const [table, config] of this.#configs) {
      const buffer = this.#buffers.get(table)!
      const staged = this.#staged.get(table) ?? []
      const released = buffer.push(staged, finalization)

      if (released.length > 0) {
        const writer = this.#getOrCreateWriter(table, config)
        for (const row of released) {
          await writer.appendRow(row, Number(row[config.blockColumn]))
        }
        stats.push({ table, rows: released.length })
      }
    }

    this.#staged.clear()

    return stats
  }

  /** True if any open writer has reached the byte or row rotation threshold. */
  async shouldRotate(limits: RotationLimits): Promise<boolean> {
    for (const writer of this.#writers.values()) {
      if (limits.maxRows !== undefined && writer.rowCount >= limits.maxRows) return true
      if ((await writer.size()) >= limits.maxBytes) return true
    }

    return false
  }

  /** Whether any segment writer is currently open (has buffered ≥1 finalized row on disk). */
  get hasOpenWriters(): boolean {
    return this.#writers.size > 0
  }

  /**
   * Publishes every currently-open segment writer (each holds ≥1 finalized row by lazy-open) and
   * resets them, returning each published file's stats. Call immediately before persisting the
   * checkpoint cursor.
   */
  async publishAll(): Promise<(PublishedSegment & { table: string })[]> {
    const published: (PublishedSegment & { table: string })[] = []

    for (const [table, writer] of this.#writers) {
      published.push({ table, ...(await writer.publish()) })
    }
    this.#writers.clear()

    return published
  }

  /**
   * Resolves the safe cursor for a reorg and drops every buffered (unfinalized) row above it.
   * Open writers and published files are never touched — they hold only finalized rows, which
   * can never reorg.
   *
   * Every buffer carries the same rollback chain (advanced on every batch), so each resolves the
   * same safe cursor; we drop rows in all of them and return the agreed result.
   */
  async fork(previousBlocks: BlockCursor[]): Promise<BlockCursor | null> {
    let safe: BlockCursor | null = null

    for (const buffer of this.#buffers.values()) {
      safe = await buffer.fork(previousBlocks)
    }

    return safe
  }

  /**
   * Best-effort teardown for the error path: discards (closes + deletes) every open segment's
   * temp file. The discarded rows are finalized-but-not-checkpointed, so they regenerate from the
   * portal on the next run since the cursor never advanced past them.
   */
  async close(): Promise<void> {
    for (const writer of this.#writers.values()) {
      await writer.discard()
    }
    this.#writers.clear()
    this.#staged.clear()
  }

  #getOrCreateWriter(table: string, config: TableConfig): ParquetSegmentWriter {
    let writer = this.#writers.get(table)
    if (!writer) {
      writer = new ParquetSegmentWriter({ dir: config.dir, schema: config.schema, rowGroupSize: this.#rowGroupSize })
      this.#writers.set(table, writer)
    }

    return writer
  }
}
