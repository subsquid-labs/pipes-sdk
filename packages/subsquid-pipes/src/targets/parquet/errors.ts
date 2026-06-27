import { PipeError, SdkError } from '~/core/errors.js'

/**
 * Common error wrapper for everything thrown by the Parquet target.
 *
 * All target-originated errors extend this class and carry an `E12xx` code so
 * downstream code can pattern-match on `instanceof ParquetTargetError` and react
 * (alerting, retries, etc.) without scraping `.message`. The numeric code prefix
 * follows the project's existing convention (E0xxx = source, E1xxx = targets);
 * BigQuery occupies E11xx, so the Parquet target uses E12xx.
 */
export class ParquetTargetError extends PipeError {
  constructor(code: string, message: string | string[]) {
    super(code, SdkError.TargetConfiguration, message)
  }
}

// E12xx — Parquet target codes
export const PQ_ERR = {
  /** `tables[]` is empty — the target has nothing to write. */
  NO_TABLES: 'E1201',
  /** Two declared tables share the same name. */
  DUPLICATE_TABLE: 'E1202',
  /** A table schema is empty (no columns declared). */
  EMPTY_SCHEMA: 'E1203',
  /** Table schema is missing the declared block-number column. */
  BLOCK_COLUMN_MISSING: 'E1204',
  /** Block-number column is not an integer type (must be INT64/INT32/TIMESTAMP_MILLIS). */
  BLOCK_COLUMN_TYPE: 'E1205',
  /** A column declared an unsupported compression codec. */
  UNSUPPORTED_COMPRESSION: 'E1206',
  /** A column declared an unsupported Parquet type. */
  UNSUPPORTED_TYPE: 'E1207',
  /** User wrote to a table that wasn't registered in `tables[]`. */
  UNREGISTERED_TABLE: 'E1208',
  /** `publish()` refused to overwrite an existing data file (would lose data). */
  FILE_COLLISION: 'E1209',
  /** Persisted state file exists but could not be parsed. */
  STATE_CORRUPT: 'E1210',
  /** The block-number column is declared `optional` — it must be present on every row. */
  BLOCK_COLUMN_OPTIONAL: 'E1211',
  /** A row carried a missing/non-finite block number (would corrupt finalization & recovery). */
  BLOCK_VALUE_INVALID: 'E1212',
  /** A row value does not match its declared column type (dev-mode value check). */
  VALUE_INVALID: 'E1213',
  /** Crash recovery could not delete an over-cursor data file (leaving it would duplicate data). */
  RECOVERY_DELETE_FAILED: 'E1214',
} as const
