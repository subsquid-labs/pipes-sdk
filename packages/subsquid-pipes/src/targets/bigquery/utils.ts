import type { TableField, TableMetadata } from '@google-cloud/bigquery'

import { BQ_ERR, BigQueryTargetError } from './errors.js'

/**
 * Detects "Not Found" errors from the @google-cloud/bigquery client.
 *
 * BQ surfaces missing tables/datasets/jobs as either a `code: 404` ApiError or
 * an Error whose message starts with "Not found:". We also walk the `cause`
 * chain because the client wraps lower-level errors at multiple layers.
 */
export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const e = error as { code?: number | string; message?: string; cause?: unknown; errors?: { reason?: string }[] }

  if (e.code === 404 || e.code === '404') return true
  if (typeof e.message === 'string' && /not found/i.test(e.message)) return true
  if (Array.isArray(e.errors) && e.errors.some((x) => x?.reason === 'notFound')) return true
  if (e.cause) return isNotFoundError(e.cause)

  return false
}

/**
 * Detects transient BigQuery errors that should be retried by `doWithRetry`.
 *
 * gRPC error codes:
 *   ABORTED (10), RESOURCE_EXHAUSTED (8), UNAVAILABLE (14), DEADLINE_EXCEEDED (4), INTERNAL (13)
 *
 * Storage Write API surfaces these as `code` numeric properties on the rejected promise.
 * The BigQuery REST client uses HTTP-style codes (429, 500, 502, 503, 504).
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const e = error as { code?: number | string; cause?: unknown }
  const code = typeof e.code === 'string' ? Number.parseInt(e.code, 10) : e.code

  if (code === 4 || code === 8 || code === 10 || code === 13 || code === 14) return true
  if (code === 429 || code === 500 || code === 502 || code === 503 || code === 504) return true
  if (e.cause) return isTransientError(e.cause)

  return false
}

/**
 * Looks up a field by name in a BQ table's schema. Returns undefined if not present.
 */
export function findField(metadata: TableMetadata, name: string): TableField | undefined {
  return metadata.schema?.fields?.find((f) => f.name === name)
}

/**
 * Asserts that `<columnName>` exists, is INT64, and is REQUIRED (NOT NULL).
 *
 * Why these three constraints are non-negotiable for the partition column:
 *
 * - **NULLable**: SQL three-valued logic — `WHERE bn > @safe` does NOT match rows where bn IS NULL.
 *   Such rows would survive every fork DELETE → silent post-fork corruption.
 * - **FLOAT64 / NUMERIC / BIGNUMERIC**: precision loss above 2^53 (Solana slot numbers can exceed
 *   this). `BETWEEN @safe+1 AND @upper` becomes inexact → some rows leak through DELETE.
 * - **STRING / other**: `RANGE_BUCKET(...)` does not work; `BETWEEN` does lexicographic compare,
 *   which is wildly wrong across digit-length transitions ("9" > "10").
 */
export function assertInt64NotNull(metadata: TableMetadata, columnName: string, tableFqn: string): void {
  const field = findField(metadata, columnName)

  if (!field) {
    throw new BigQueryTargetError(
      BQ_ERR.PARTITION_COLUMN_MISSING,
      `Table ${tableFqn} is missing the partition column '${columnName}'. Add it as INT64 NOT NULL, then re-run.`,
    )
  }

  const type = (field.type || '').toUpperCase()
  if (type !== 'INT64' && type !== 'INTEGER') {
    throw new BigQueryTargetError(
      BQ_ERR.PARTITION_COLUMN_TYPE,
      `Table ${tableFqn} has '${columnName}' typed as ${field.type}, but the BigQuery target ` +
        `requires INT64. Reason: ${type === 'FLOAT64' || type === 'FLOAT' || type === 'NUMERIC' || type === 'BIGNUMERIC' ? `${type} loses precision above 2^53 (Solana slot numbers exceed this), making BETWEEN predicates inexact during reorg cleanup.` : `${type} cannot be used with RANGE_BUCKET partitioning, and BETWEEN compares lexicographically — wrong across digit-length transitions.`}`,
    )
  }

  // BQ default mode is NULLABLE when not specified.
  const mode = (field.mode || 'NULLABLE').toUpperCase()
  if (mode !== 'REQUIRED') {
    throw new BigQueryTargetError(
      BQ_ERR.PARTITION_COLUMN_NULLABLE,
      `Table ${tableFqn} has '${columnName}' as ${mode}, but the BigQuery target requires NOT NULL. ` +
        `Reason: SQL three-valued logic means rows with NULL ${columnName} do NOT match ` +
        `the WHERE predicate during fork DELETE, leaving them uncleaned forever.`,
    )
  }
}

/**
 * Asserts the table is range-partitioned on `<columnName>`.
 * Without this, DELETE during fork cleanup scans the entire table → unaffordable on real data.
 */
export function assertRangePartitionedOn(
  metadata: TableMetadata,
  columnName: string,
  tableFqn: string,
  suggestedDdl: string,
): void {
  const field = metadata.rangePartitioning?.field
  if (field !== columnName) {
    throw new BigQueryTargetError(
      BQ_ERR.TABLE_NOT_PARTITIONED,
      `Table ${tableFqn} is not range-partitioned on '${columnName}' ` +
        `(found: ${field ? `range-partitioned on '${field}'` : 'no range partitioning'}). ` +
        `Reorg DELETE without partition pruning scans the whole table — unaffordable at scale. ` +
        `Suggested DDL:\n\n${suggestedDdl}`,
    )
  }
}
