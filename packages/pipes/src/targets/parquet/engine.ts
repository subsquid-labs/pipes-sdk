import { duckdbEngine } from './duckdb-writer.js'
import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import { parquetjsEngine } from './parquetjs-writer.js'
import type { Codec, ParquetTable } from './schema.js'
import type { SegmentWriter } from './segment.js'

/** Resolved per-table write settings every engine receives. */
export type ParquetTableContext = {
  /** The table's output directory (`<dir>/<table>`), created by the state layer before writes. */
  dir: string
  /** Rows per row group. */
  rowGroupSize: number
  /** File-level default compression codec. */
  codec: Codec
}

/** Per-table handle created once at target startup; creates one writer per segment file. */
export interface ParquetTableWriter {
  /** Creates the writer for this table's NEXT segment file. Called once per file rotation. */
  createSegment(): SegmentWriter
}

/**
 * A pluggable segment-writer engine for `parquetTarget`.
 *
 * The target owns everything around the writer — staging, finalization buffering, rotation
 * triggers, checkpointing, crash recovery, fork handling and metrics. An engine owns exactly
 * one thing: turning finalized rows into a Parquet file on disk. The SDK's declared schema
 * model ({@link ParquetTable}) plus the plain-JS row contract (see the `ParquetLeafType`
 * JSDoc) is the complete input; engines translate both to their native representation
 * internally, so there is no engine-specific schema mechanism at the API surface.
 *
 * Implementations MUST:
 * - produce real Parquet files — downstream readers rely on it;
 * - name segment temp files via `nextTmpPath` (startup recovery deletes `.tmp-*` files);
 * - publish through `finalizeSegmentFile` (fsync → collision check → atomic rename → dir
 *   fsync), the durability tail that checkpoints depend on;
 * - keep `table()` synchronous and cheap — defer library loading and other async setup to
 *   the first `appendRow`, exactly like both built-in engines do;
 * - accept rows in the plain-JS shape (`LIST` cells are plain arrays, `STRUCT` cells plain
 *   objects) — any library-specific row reshaping happens inside the engine.
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

/** Names of the engines shipped with the SDK, accepted as `settings.engine` shorthand. */
export type ParquetEngineName = 'parquetjs' | 'duckdb'

/**
 * Resolves `settings.engine` to a {@link ParquetEngine}: `undefined` → the default parquetjs
 * engine, a built-in name → that engine with default settings, an instance → itself. Rejects
 * anything else at construction with `ENGINE_INVALID`.
 */
export function resolveEngine(engine: ParquetEngine | ParquetEngineName | undefined): ParquetEngine {
  if (engine === undefined || engine === 'parquetjs') return parquetjsEngine()
  if (engine === 'duckdb') return duckdbEngine()
  if (
    typeof engine === 'object' &&
    engine !== null &&
    typeof engine.table === 'function' &&
    typeof engine.name === 'string'
  ) {
    return engine
  }

  throw new ParquetTargetError(
    PARQUET_ERROR_CODES.ENGINE_INVALID,
    `parquetTarget: settings.engine must be 'parquetjs' (default), 'duckdb', or a ParquetEngine ` +
      `implementation ({ name, table() }), got ${typeof engine === 'string' ? `'${engine}'` : typeof engine}.`,
  )
}
