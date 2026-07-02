import type { BigQuery, TableField, TableMetadata } from '@google-cloud/bigquery'

import { BQ_ERR, BigQueryTargetError } from './errors.js'
import { assertInt64NotNull, assertRangePartitionedOn, findField, isNotFoundError } from './utils.js'

export type TrackedTable = {
  /** Unqualified table name. */
  table: string
  /** Column name used for partitioning + reorg DELETE scoping. Must be INT64 NOT NULL. */
  blockNumberColumn: string
  /** BigQuery field definitions for auto-creation and schema validation. */
  schema: TableField[]
  /** Optional CLUSTER BY columns (recommended for natural primary keys). */
  clusterBy?: string[]
}

export type PartitioningOptions = {
  /** Width of each RANGE_BUCKET partition. Defaults to 10_000 blocks. */
  bucketSize?: number
  /** Upper bound of the GENERATE_ARRAY for RANGE_BUCKET. Defaults to 100_000_000 blocks. */
  maxBlocks?: number
}

/**
 * `false` disables both `PARTITION BY` and `CLUSTER BY` DDL emission. Production must keep it
 * enabled — a single fork DELETE on a 1B-row unpartitioned table costs $5+ per call.
 *
 * Cluster-without-partition is rare enough that we don't expose it as a separate flag; users
 * who need it can pre-create the table themselves, and the validation path will accept any
 * cluster shape.
 */
export type PartitioningSetting = PartitioningOptions | false

const DEFAULT_BUCKET_SIZE = 10_000
const DEFAULT_MAX_BLOCKS = 100_000_000

export type SyncTableLocation = {
  /** Fully-qualified `dataset.table`. */
  fqn: string
  /** Dataset id. */
  dataset: string
  /** Table id. */
  table: string
}

/**
 * DDL for the WAL sync table.
 *
 * Encodes the four-state machine via (op, committed):
 *   (commit,   false) = IN_FLIGHT_COMMIT      — about to write blocks [range_low, range_high]
 *   (commit,   true ) = COMMITTED             — write succeeded, cursor advanced
 *   (rollback, false) = IN_FLIGHT_ROLLBACK    — about to DELETE blocks [range_low, range_high]
 *   (rollback, true ) = ROLLED_BACK           — DELETEs succeeded
 *
 * `range_low/high` are NULL on COMPLETED rows; set on IN_FLIGHT rows.
 *
 * `timestamp` defaults to `CURRENT_TIMESTAMP()` server-side: every row is stamped with
 * µs-precision wall-clock time by BigQuery, giving a single source of truth for write
 * order without a client-side counter and without client/server clock-skew concerns.
 *
 * The table is intentionally unpartitioned — it stays small (≤ `maxRows` per stream id,
 * default 10 000) so partition pruning buys nothing, and `cleanupOldRows` already keeps
 * it bounded.
 */
export function syncTableDdl(opts: SyncTableLocation): string {
  // Backtick-quote every column name. `current` and `timestamp` are BigQuery reserved
  // keywords; without quoting, the parser fails with `Syntax error: Expected ")" or ","
  // but got keyword CURRENT`. Quoting all of them is uniform and future-proof against
  // BQ adding new reserved words.
  return `
    CREATE TABLE IF NOT EXISTS \`${opts.fqn}\` (
      \`id\`              STRING NOT NULL,
      \`op\`              STRING NOT NULL,
      \`current\`         STRING,
      \`finalized\`       STRING,
      \`rollback_chain\`  STRING NOT NULL,
      \`range_low\`       INT64,
      \`range_high\`      INT64,
      \`committed\`       BOOL NOT NULL,
      \`timestamp\`       TIMESTAMP DEFAULT CURRENT_TIMESTAMP() NOT NULL
    );
  `.trim()
}

/**
 * DDL for an auto-created tracked user table.
 *
 * The blockNumberColumn is forced to INT64 NOT NULL (overriding whatever the user
 * passed), because the partition + DELETE story breaks for any other type/mode —
 * see `assertInt64NotNull` for the full reasoning.
 *
 * Throws if the schema does not include the partition column at all — without this
 * check the generated DDL would reference an undefined column inside RANGE_BUCKET(...)
 * and BigQuery would reject it with a raw SQL error rather than the clean validation
 * the target promises (review fix #6).
 */
export function trackedTableDdl(
  fqn: string,
  trackedTable: TrackedTable,
  partitioning: Required<PartitioningOptions> | false,
): string {
  assertSchemaIncludesPartitionColumn(trackedTable, fqn)
  assertFlatSchema(trackedTable.schema, fqn)

  const fields = normalizePartitionColumn(trackedTable.schema, trackedTable.blockNumberColumn)
    .map((f) => {
      const mode = (f.mode || '').toUpperCase() === 'REQUIRED' ? ' NOT NULL' : ''
      return `  \`${f.name}\` ${f.type}${mode}`
    })
    .join(',\n')

  // When partitioning is disabled we drop CLUSTER BY too — cluster-without-partition is rare
  // enough not to warrant a separate flag, and the two clauses are typically required-or-not
  // required together by the BQ-compatible backends users actually disable partitioning for.
  const cluster =
    partitioning && trackedTable.clusterBy && trackedTable.clusterBy.length > 0
      ? `\n    CLUSTER BY ${trackedTable.clusterBy.map((c) => `\`${c}\``).join(', ')}`
      : ''

  const partitionClause = partitioning
    ? `\n    PARTITION BY RANGE_BUCKET(\n      \`${trackedTable.blockNumberColumn}\`,\n      GENERATE_ARRAY(0, ${partitioning.maxBlocks}, ${partitioning.bucketSize})\n    )`
    : ''

  return `
    CREATE TABLE IF NOT EXISTS \`${fqn}\` (
${fields}
    )${partitionClause}${cluster};
  `.trim()
}

/**
 * Returns a copy of the schema with the partition column coerced to INT64 NOT NULL.
 *
 * Used in two places that must agree byte-for-byte (review fix #4):
 *   1. `trackedTableDdl` — the CREATE TABLE statement materializes this type.
 *   2. `BigQueryStore` constructor — the proto descriptor used for AppendRows is built
 *      from THIS normalized schema, not the user's original. Without that, a user who
 *      declares the partition column as STRING gets a table with INT64 (from the DDL
 *      coercion) but a proto descriptor saying STRING → first append fails with a
 *      mismatched-schema error.
 */
export function normalizePartitionColumn(schema: TableField[], blockNumberColumn: string): TableField[] {
  return schema.map((f) => (f.name === blockNumberColumn ? { ...f, type: 'INT64', mode: 'REQUIRED' } : f))
}

function assertSchemaIncludesPartitionColumn(t: TrackedTable, fqn: string): void {
  if (!t.schema.some((f) => f.name === t.blockNumberColumn)) {
    throw new BigQueryTargetError(
      BQ_ERR.PARTITION_COLUMN_MISSING,
      `Tracked table '${fqn}' schema does not include the partition column ` +
        `'${t.blockNumberColumn}'. Add it to the tables[].schema config as ` +
        `INT64 NOT NULL — the target forces this type/mode regardless of what you declare, ` +
        `but the column itself must be present.`,
    )
  }
}

/**
 * Rejects schemas with REPEATED mode (arrays) or RECORD/STRUCT type (nested fields).
 * The DDL generator and `assertSchemaMatches` only handle flat scalar fields — letting a
 * REPEATED/RECORD field through would emit `name TYPE` instead of `name ARRAY<TYPE>` /
 * `name STRUCT<...>`, then validation would not catch the mismatch and AppendRows would
 * fail on the first batch with a confusing proto-descriptor error.
 *
 * If users genuinely need nested or array fields, they can pre-create the table manually
 * and the target will validate the partition column + schema match without recreating it.
 */
function assertFlatSchema(schema: TableField[], fqn: string): void {
  for (const f of schema) {
    const type = (f.type || '').toUpperCase()
    const mode = (f.mode || '').toUpperCase()
    if (mode === 'REPEATED') {
      throw new BigQueryTargetError(
        BQ_ERR.UNSUPPORTED_FIELD_SHAPE,
        `Tracked table '${fqn}' field '${f.name}' has mode=REPEATED. The target's ` +
          `auto-creation does not support array fields — pre-create the table manually with ` +
          `the proper ARRAY<...> column and re-run; the target will validate without recreating.`,
      )
    }
    if (type === 'RECORD' || type === 'STRUCT') {
      throw new BigQueryTargetError(
        BQ_ERR.UNSUPPORTED_FIELD_SHAPE,
        `Tracked table '${fqn}' field '${f.name}' has type=${f.type}. The target's ` +
          `auto-creation does not support nested fields — pre-create the table manually with ` +
          `the proper STRUCT<...> column and re-run.`,
      )
    }
  }
}

export function partitioningWithDefaults(p?: PartitioningSetting): Required<PartitioningOptions> | false {
  if (p === false) return false
  return {
    bucketSize: p?.bucketSize ?? DEFAULT_BUCKET_SIZE,
    maxBlocks: p?.maxBlocks ?? DEFAULT_MAX_BLOCKS,
  }
}

/**
 * Validates a tracked user table, auto-creating it if missing.
 *
 * On a missing table → creates it with correct RANGE_BUCKET partitioning and forces the
 * partition column to INT64 NOT NULL. On a found table → asserts:
 *   1. Range-partitioned on the declared blockNumberColumn.
 *   2. blockNumberColumn is INT64 NOT NULL (not FLOAT64/NUMERIC/STRING/NULLable — see utils.ts).
 *   3. Each declared schema field exists with the same type.
 *
 * Throws with a clear, user-actionable error message (including the suggested DDL) on any
 * mismatch — silent acceptance would result in unaffordable DELETEs or silent data
 * corruption during reorgs.
 */
export async function ensureTrackedTable({
  bigquery,
  projectId,
  dataset,
  trackedTable,
  partitioning,
}: {
  bigquery: BigQuery
  projectId: string
  dataset: string
  trackedTable: TrackedTable
  partitioning: Required<PartitioningOptions> | false
}): Promise<void> {
  // projectId is passed explicitly: if the BigQuery client is constructed without a
  // projectId, `client.bigquery.projectId` is undefined and validation would silently run
  // against the wrong project while the store/state (which use the explicit projectId)
  // write somewhere else.
  const fqn = `${projectId}.${dataset}.${trackedTable.table}`
  const tableRef = bigquery.dataset(dataset).table(trackedTable.table)

  let metadata: TableMetadata
  try {
    ;[metadata] = (await tableRef.getMetadata()) as [TableMetadata, unknown]
  } catch (e) {
    if (isNotFoundError(e)) {
      // Auto-create branch: trackedTableDdl runs assertFlatSchema. Generating the DDL only
      // here means a user with REPEATED/RECORD fields who pre-creates the table manually
      // (the documented escape hatch) actually reaches the validation path on subsequent
      // runs, instead of hitting `UNSUPPORTED_FIELD_SHAPE` before getMetadata is even called.
      const ddl = trackedTableDdl(fqn, trackedTable, partitioning)
      await bigquery.query({ query: ddl })
      return
    }
    throw e
  }

  // Existing-table branch: the user can have any schema shape they like (including
  // REPEATED/RECORD they pre-created). When partitioning is enabled we additionally enforce
  // RANGE_BUCKET on the declared blockNumberColumn — without this assertion an unpartitioned
  // table would accept writes but fork DELETEs would scan-and-bill the entire table on every
  // reorg. With partitioning disabled we skip the range-partition check (the user has opted
  // into that cost).
  if (partitioning) {
    const partitionClause =
      `PARTITION BY RANGE_BUCKET(\`${trackedTable.blockNumberColumn}\`, ` +
      `GENERATE_ARRAY(0, ${partitioning.maxBlocks}, ${partitioning.bucketSize}))`
    assertRangePartitionedOn(metadata, trackedTable.blockNumberColumn, fqn, partitionClause)
  }
  assertInt64NotNull(metadata, trackedTable.blockNumberColumn, fqn)
  // Validate against the NORMALIZED schema (partition column coerced to INT64 NOT NULL),
  // matching what the auto-create DDL actually materialized. Otherwise a user who declared
  // `block_number: STRING` would pass first-startup auto-create (table created as INT64),
  // then fail second-startup with "column 'block_number' has type INT64, declared as STRING"
  // — even though the live table is exactly what the target wants.
  assertSchemaMatches(metadata, normalizePartitionColumn(trackedTable.schema, trackedTable.blockNumberColumn), fqn)
}

/**
 * Verifies every declared field exists in the live table with a matching type.
 * Extra columns in the live table are tolerated (forward-compatible additions).
 */
export function assertSchemaMatches(metadata: TableMetadata, declared: TableField[], tableFqn: string): void {
  for (const decl of declared) {
    const live = findField(metadata, decl.name!)
    if (!live) {
      throw new BigQueryTargetError(
        BQ_ERR.SCHEMA_FIELD_MISSING,
        `Table ${tableFqn} is missing declared column '${decl.name}' of type ${decl.type}.`,
      )
    }
    // Legacy-SQL ↔ GoogleSQL aliases: BQ accepts the modern name in DDL but reports the
    // legacy name in REST metadata, so a `FLOAT64` column comes back as `FLOAT` and a fresh
    // round-trip would falsely fail validation. Canonicalize both sides before comparing.
    if (canonicalType(live.type) !== canonicalType(decl.type)) {
      throw new BigQueryTargetError(
        BQ_ERR.SCHEMA_TYPE_MISMATCH,
        `Table ${tableFqn} column '${decl.name}' has type ${live.type}, but declared as ${decl.type}.`,
      )
    }
    // Compare mode too (NULLABLE / REQUIRED / REPEATED). Without this, a live `tags STRING
    // REPEATED` passes when declared as a scalar `tags STRING` and the first AppendRows
    // fails at runtime with a confusing proto-shape mismatch. BQ defaults missing mode to
    // NULLABLE — normalize both sides before comparing.
    const liveMode = (live.mode || 'NULLABLE').toUpperCase()
    const declMode = (decl.mode || 'NULLABLE').toUpperCase()
    if (liveMode !== declMode) {
      throw new BigQueryTargetError(
        BQ_ERR.SCHEMA_TYPE_MISMATCH,
        `Table ${tableFqn} column '${decl.name}' has mode ${liveMode}, but declared as ${declMode}.`,
      )
    }
  }
}

/**
 * GoogleSQL type names normalised against their legacy-SQL aliases. BigQuery accepts the
 * modern name in DDL but reports the legacy name in REST metadata, so without this
 * canonicalisation a `FLOAT64` declaration validates against a live `FLOAT` column as a
 * mismatch on the second startup — even though the table is exactly what the target wants.
 */
const LEGACY_TYPE_ALIASES: Record<string, string> = {
  INTEGER: 'INT64',
  FLOAT: 'FLOAT64',
  BOOLEAN: 'BOOL',
}

function canonicalType(type?: string): string {
  const t = (type || '').toUpperCase()
  return LEGACY_TYPE_ALIASES[t] ?? t
}
