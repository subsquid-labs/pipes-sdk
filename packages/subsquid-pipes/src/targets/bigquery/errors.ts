import { PipeError, SdkError } from '~/core/errors.js'

/**
 * Common error wrapper for everything thrown by the BigQuery target.
 *
 * All target-originated errors extend this class and carry an `E11xx` code so
 * downstream code can pattern-match on `instanceof BigQueryTargetError` and react
 * (alerting, retries, etc.) without scraping `.message`. The numeric code prefix
 * follows the project's existing convention (E0xxx = source, E1xxx = targets).
 */
export class BigQueryTargetError extends PipeError {
  constructor(code: string, message: string | string[]) {
    super(code, SdkError.TargetConfiguration, message)
  }
}

// E11xx — BigQuery target codes
export const BQ_ERR = {
  /** Cannot determine GCP project id at target construction. */
  PROJECT_ID: 'E1101',
  /** Tracked table schema is missing the declared partition column. */
  PARTITION_COLUMN_MISSING: 'E1102',
  /** Partition column has the wrong type (must be INT64). */
  PARTITION_COLUMN_TYPE: 'E1103',
  /** Partition column is NULLable (must be REQUIRED). */
  PARTITION_COLUMN_NULLABLE: 'E1104',
  /** Existing live table is not range-partitioned on the declared column. */
  TABLE_NOT_PARTITIONED: 'E1105',
  /** Auto-create cannot generate DDL for REPEATED/RECORD/STRUCT fields. */
  UNSUPPORTED_FIELD_SHAPE: 'E1106',
  /** Declared field missing from the live table. */
  SCHEMA_FIELD_MISSING: 'E1107',
  /** Declared field has a different type in the live table. */
  SCHEMA_TYPE_MISMATCH: 'E1108',
  /** User wrote to a table that wasn't registered in tables[]. */
  UNREGISTERED_TABLE: 'E1109',
  /** Internal: schema map and allowlist disagree (should be unreachable). */
  INTERNAL_SCHEMA_MAP: 'E1110',
  /** Sync row in IN_FLIGHT state lacks the range_low/range_high it needs for recovery. */
  CORRUPT_INFLIGHT_ROW: 'E1111',
  /** Portal sent previousBlocks whose max block is below our persisted cursor. */
  PORTAL_INVARIANT: 'E1112',
  /**
   * Sync table has no rows for this stream id, but tracked tables still hold data — refusing
   * to silently restart from the initial cursor (would re-process and duplicate everything).
   * Surfaces accidental sync truncation / drop / row deletion before it becomes corruption.
   */
  ORPHAN_TRACKED_DATA: 'E1113',
  /**
   * `AppendRows` resolved without a channel error, but the response carries per-row
   * `rowErrors` from BigQuery (proto-schema mismatch, NOT NULL violation, etc.). The SDK
   * does not propagate these as rejections — without an explicit check the row is silently
   * dropped while our code believes the write succeeded.
   */
  APPEND_ROW_REJECTED: 'E1114',
} as const
