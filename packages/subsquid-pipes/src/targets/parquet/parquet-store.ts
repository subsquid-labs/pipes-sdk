import path from 'node:path'

import { ParquetSchema } from '@dsnp/parquetjs'

import { type BlockCursor, type Finalization, type FinalizationBuffer, createFinalizationBuffer } from '~/core/index.js'

import { PQ_ERR, ParquetTargetError } from './errors.js'
import { type Codec, type ParquetColumns, type ParquetTable, blockColumnOf, toParquetSchemaShape } from './schema.js'
import { ParquetSegmentWriter, type PublishedSegment } from './writer.js'

type Row = Record<string, unknown>

/** Per-table immutable config resolved once at construction. */
type TableConfig = {
  blockColumn: string
  /** Reads + validates a row's block number (always-on guard against null/NaN). */
  getBlockNumber: (row: Row) => number
  /** Declared column shape, kept for the dev-mode value check. */
  columns: ParquetColumns
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
  // Per-cell type checking is a hot-path cost, so it only runs outside production.
  readonly #validateValues = process.env.NODE_ENV !== 'production'

  constructor(options: { dir: string; tables: ParquetTable[]; rowGroupSize: number; defaultCodec: Codec }) {
    this.#rowGroupSize = options.rowGroupSize

    for (const table of options.tables) {
      const blockColumn = blockColumnOf(table)
      const getBlockNumber = (row: Row): number => readBlockNumber(table.table, blockColumn, row)
      this.#configs.set(table.table, {
        blockColumn,
        getBlockNumber,
        columns: table.schema,
        schema: new ParquetSchema(toParquetSchemaShape(table, options.defaultCodec)),
        dir: path.join(options.dir, table.table),
      })
      this.#buffers.set(table.table, createFinalizationBuffer<Row>({ getBlockNumber }))
    }
  }

  /**
   * Stages rows for `table` until the next `flushBatch`. Throws synchronously if `table` was not
   * declared in `tables[]` — an unknown table can never be finalized, rotated or recovered, so
   * surfacing it immediately (before any I/O) is safer than silently dropping the rows.
   */
  insert(table: string, rows: Row[]): void {
    const config = this.#configs.get(table)
    if (!config) {
      throw new ParquetTargetError(
        PQ_ERR.UNREGISTERED_TABLE,
        `Table '${table}' is not declared. Declared tables: ${[...this.#configs.keys()].sort().join(', ')}. ` +
          `Add it to parquetTarget({ tables: [...] }).`,
      )
    }
    if (rows.length === 0) return

    if (this.#validateValues) {
      for (const row of rows) validateRowValues(table, config.columns, row)
    }

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
          await writer.appendRow(row, config.getBlockNumber(row))
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
   * Every buffer carries an identical rollback chain (`flushBatch` advances them all in lockstep
   * with the same finalization), so resolve the safe cursor ONCE and reuse it to drop rows in
   * each buffer — resolving per buffer would repeat the identical walk N times.
   */
  async fork(previousBlocks: BlockCursor[]): Promise<BlockCursor | null> {
    const buffers = [...this.#buffers.values()]
    if (buffers.length === 0) {
      return null
    }

    const safe = await buffers[0].resolveFork(previousBlocks)
    for (const buffer of buffers) {
      buffer.dropAbove(safe)
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

// JS has no built-in INT32 bounds (only Number.MAX_SAFE_INTEGER, which is 53-bit).
const INT32_MIN = -2_147_483_648
const INT32_MAX = 2_147_483_647

/**
 * Reads a row's block number and fails loudly on a missing/non-finite value. The block column is
 * load-bearing — it drives finalization (`<= finalized`), `<min>-<max>` file naming and recovery —
 * so coercing `null` to 0 (an immutable block-0 row) or `undefined` to `NaN` (buffered forever and
 * silently lost) would corrupt durability. This guard is always on, including in production.
 */
function readBlockNumber(table: string, blockColumn: string, row: Row): number {
  const raw = row[blockColumn]
  const value = Number(raw)
  if (raw == null || !Number.isFinite(value)) {
    throw new ParquetTargetError(
      PQ_ERR.BLOCK_VALUE_INVALID,
      `Table '${table}' has a row whose block-number column '${blockColumn}' is ${describe(raw)}. ` +
        `It must be a finite integer on every row.`,
    )
  }

  return value
}

/**
 * Dev-mode (non-production) check that each cell matches its declared column type, catching silent
 * corruption the Parquet encoder would otherwise wave through — most notably a hex *string* handed
 * to a `BYTE_ARRAY` column (stored as the ASCII bytes of `"0x…"`, not the decoded bytes) and a
 * `number` above 2^53 for an `INT64` column (precision already lost before the write).
 */
function validateRowValues(table: string, columns: ParquetColumns, row: Row): void {
  for (const [name, column] of Object.entries(columns)) {
    const value = row[name]

    if (value == null) {
      if (!column.optional) {
        throw new ParquetTargetError(
          PQ_ERR.VALUE_INVALID,
          `Table '${table}' column '${name}' is required but the row value is ${describe(value)}.`,
        )
      }

      continue
    }

    const problem = checkValueType(column.type, value)
    if (problem) {
      throw new ParquetTargetError(
        PQ_ERR.VALUE_INVALID,
        `Table '${table}' column '${name}' (declared ${column.type}) ${problem}, got ${describe(value)}.`,
      )
    }
  }
}

/** Returns a human description of why `value` is wrong for `type`, or `undefined` if it is fine. */
function checkValueType(type: string, value: unknown): string | undefined {
  switch (type) {
    case 'BYTE_ARRAY':
      if (!(value instanceof Uint8Array)) {
        return 'expects a Buffer/Uint8Array (a hex string is stored as raw ASCII — use Buffer.from(hex, "hex"))'
      }

      return undefined

    case 'INT32':
      if (typeof value === 'bigint') return value < INT32_MIN || value > INT32_MAX ? 'is out of INT32 range' : undefined
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'expects an integer'

      return value < INT32_MIN || value > INT32_MAX ? 'is out of INT32 range' : undefined

    case 'INT64':
      if (typeof value === 'bigint') return undefined
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'expects an integer or bigint'

      return Number.isSafeInteger(value)
        ? undefined
        : 'exceeds 2^53-1 as a JS number and would lose precision — pass a bigint'

    case 'DOUBLE':
      return typeof value === 'number' ? undefined : 'expects a number'

    case 'BOOLEAN':
      return typeof value === 'boolean' ? undefined : 'expects a boolean'

    case 'UTF8':
      return typeof value === 'string' ? undefined : 'expects a string'

    case 'TIMESTAMP_MILLIS':
      return value instanceof Date || typeof value === 'number' ? undefined : 'expects a Date or epoch-millis number'

    default:
      return undefined
  }
}

/** Safe, never-throwing rendering of an arbitrary value for error messages (handles bigint/null). */
function describe(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'string') return JSON.stringify(value)

  return String(value)
}
