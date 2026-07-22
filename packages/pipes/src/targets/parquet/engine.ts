import type { Codec, ParquetTable } from './schema.js'
import type { SegmentWriter } from './segment.js'

/**
 * Resolved per-table write settings every engine receives. Both are *encoding requests*, not
 * target invariants: the target's correctness (naming, durability, recovery) never depends on
 * them. An engine should honor them at least approximately, and must refuse (throw from
 * `table()`) a declaration it cannot honor rather than silently ignore it.
 */
export type ParquetTableContext = {
  /**
   * Rows per row group — a row count, not bytes. Writer-side it is the in-memory flush
   * threshold (how many rows are buffered before a row group is encoded to disk), reader-side
   * the pruning granularity. It is how users bound an engine's staging memory.
   */
  rowGroupSize: number
  /**
   * Compression codec for columns that do not declare their own — the resolved
   * `settings.compression` default. Individual columns may override it via
   * `column.compression` in the declared schema; an engine limited to one file-level codec
   * (e.g. DuckDB's COPY) must throw from `table()` when a column declares an override.
   */
  defaultCompression: Codec
}

/** Per-table handle created once at target startup; creates one writer per segment file. */
export interface ParquetTableWriter {
  /**
   * Creates the writer for one segment file, writing to `tmpPath` — a target-chosen temp path
   * inside the table's output directory. Called once per file rotation. A segment may finish
   * with **zero rows appended** (tail closing claims a window the table produced nothing in),
   * so `finish()` must produce a valid schema-only Parquet file even if `append` never ran.
   */
  createSegment(tmpPath: string): SegmentWriter
}

/**
 * A pluggable segment-writer engine for `parquetTarget`.
 *
 * The target owns everything around the writer — staging, finalization buffering, rotation
 * triggers, coverage tracking, temp-file naming, publication (fsync → collision check → atomic
 * rename → dir fsync), checkpointing, crash recovery, fork handling and metrics. An engine owns
 * exactly one thing: writing finalized rows into a Parquet file at the temp path it is given.
 * It never names, renames, fsyncs or deletes files, and it never sees a block number or
 * coverage window — published files are named for the window the pipe processed, which only
 * the target knows — so naming, durability and recovery semantics cannot vary per engine. The
 * target also verifies the finished file's Parquet magic bytes before publishing it, so a
 * non-Parquet output fails loudly at the checkpoint instead of reaching downstream readers.
 *
 * The SDK's declared schema model ({@link ParquetTable}) plus the plain-JS row contract (see
 * the `ParquetLeafType` JSDoc) is the complete input: `LIST` cells arrive as plain arrays,
 * `STRUCT` cells as plain objects, and any library-specific schema or row reshaping happens
 * inside the engine — there is no engine-specific schema mechanism at the API surface.
 */
export interface ParquetEngine {
  /** Engine name, used in logs and error messages. */
  readonly name: string
  /**
   * Called once per declared table at target construction, after the model-level schema
   * validation. Validate engine capability limits here (throw `ParquetTargetError` for
   * declarations this engine cannot honor) and return the table's segment-writer factory.
   */
  table(table: ParquetTable, context: ParquetTableContext): ParquetTableWriter
}
