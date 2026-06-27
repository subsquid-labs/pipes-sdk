import { PQ_ERR, ParquetTargetError } from './errors.js'

/**
 * Compression codecs supported by `@dsnp/parquetjs` (verified by the Step 0 spike against
 * the pinned version — the library also recognises the *names* `LZO`/`LZ4`/`ZSTD` but throws
 * `Unsupported compression method` at write time, so they are intentionally excluded here).
 */
export type Codec = 'UNCOMPRESSED' | 'SNAPPY' | 'GZIP' | 'BROTLI'

/**
 * Parquet primitive/logical types exposed by this target. This is our own union — the public
 * API carries **no compile-time dependency** on `@dsnp/parquetjs` types; the strings are
 * translated to the library's `ParquetSchema` internally by the writer.
 *
 * JS → Parquet input contract (what `onData` must put in each row), per the Step 0 spike:
 * - `INT64`            ← `number` **or** `bigint` (reads back as `bigint`)
 * - `INT32`            ← `number`
 * - `DOUBLE`           ← `number`
 * - `BOOLEAN`          ← `boolean`
 * - `UTF8`             ← `string` (store hashes/addresses here for human-readable columns)
 * - `BYTE_ARRAY`       ← `Buffer` / `Uint8Array` (a hex string must be `Buffer.from(hex, 'hex')`)
 * - `TIMESTAMP_MILLIS` ← `Date` **or** `number` (epoch millis; reads back as `Date`)
 * - any column with `optional: true` may also be `null` / `undefined`
 *
 * `DECIMAL` is intentionally unsupported — use `UTF8` or a scaled `INT64` instead.
 */
export type ParquetColumnType = 'INT64' | 'INT32' | 'UTF8' | 'BYTE_ARRAY' | 'BOOLEAN' | 'DOUBLE' | 'TIMESTAMP_MILLIS'

/** Declaration for a single Parquet column. */
export type ParquetColumn = {
  type: ParquetColumnType
  /** Allow `null`/`undefined` for this column. Defaults to `false` (required). */
  optional?: boolean
  /** Per-column compression codec. Defaults to the target's `settings.compression` (`'SNAPPY'`). */
  compression?: Codec
}

/** Map of column name → column declaration. */
export type ParquetColumns = Record<string, ParquetColumn>

/** A named Parquet table with an explicit, declared schema. */
export type ParquetTable = {
  /** Table name — becomes a sub-directory `<dir>/<table>/` holding its `.parquet` files. */
  table: string
  /** Declared columns. Must be non-empty and include {@link ParquetTable.blockNumberColumn}. */
  schema: ParquetColumns
  /**
   * Column carrying the block number, used for finalization, file-range naming and recovery.
   * Must be present in `schema` as a required (non-optional) integer column (`INT64`/`INT32`)
   * whose value is the block number itself. Defaults to `'blockNumber'`.
   */
  blockNumberColumn?: string
}

/** The library-shaped schema object (our type) handed to `new ParquetSchema(...)` by the writer. */
export type ParquetSchemaShape = Record<string, { type: ParquetColumnType; optional: boolean; compression: Codec }>

export const DEFAULT_BLOCK_COLUMN = 'blockNumber'
export const DEFAULT_CODEC: Codec = 'SNAPPY'

const SUPPORTED_CODECS = new Set<string>(['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'BROTLI'])
const SUPPORTED_TYPES = new Set<string>([
  'INT64',
  'INT32',
  'UTF8',
  'BYTE_ARRAY',
  'BOOLEAN',
  'DOUBLE',
  'TIMESTAMP_MILLIS',
])
// The block column's value is compared directly against the portal's finalized block NUMBER
// (`Number(row[col]) <= finalized.number`) and used for `<min>-<max>` file naming and the
// `maxBlock > cursor` recovery check, so it must hold the block number itself. TIMESTAMP_MILLIS
// is int64-backed but carries epoch-ms, not a block number — comparing ~1.7e12 against a block
// number is always false, so no row ever finalizes (silent loss). It is therefore excluded.
const INTEGER_BLOCK_TYPES = new Set<ParquetColumnType>(['INT64', 'INT32'])

/** The block-number column name for a table, applying the default. */
export function blockColumnOf(table: ParquetTable): string {
  return table.blockNumberColumn ?? DEFAULT_BLOCK_COLUMN
}

/**
 * Validates the full `tables[]` config at target construction — empty list, duplicate names,
 * then each table. Throwing here surfaces config mistakes at startup, not deep in the first
 * batch (mirrors BigQuery's `ensureTrackedTable` up-front validation).
 */
export function validateTables(tables: ParquetTable[]): void {
  if (tables.length === 0) {
    throw new ParquetTargetError(PQ_ERR.NO_TABLES, 'parquetTarget: `tables` must declare at least one table.')
  }

  const seen = new Set<string>()
  for (const table of tables) {
    if (seen.has(table.table)) {
      throw new ParquetTargetError(
        PQ_ERR.DUPLICATE_TABLE,
        `parquetTarget: duplicate table '${table.table}'. Each table name must be unique.`,
      )
    }
    seen.add(table.table)

    validateTable(table)
  }
}

/**
 * Validates one table: non-empty schema, every column's type + compression are supported, the
 * block-number column is present and integer-typed.
 *
 * Unlike BigQuery — which *forces* the partition column to `INT64 NOT NULL` via DDL
 * (`normalizePartitionColumn`) — Parquet has no DDL/type-forcing layer, so we must validate the
 * block column's type ourselves rather than silently coerce it.
 */
export function validateTable(table: ParquetTable): void {
  const columns = Object.entries(table.schema)
  if (columns.length === 0) {
    throw new ParquetTargetError(
      PQ_ERR.EMPTY_SCHEMA,
      `parquetTarget: table '${table.table}' has an empty schema. Declare at least one column.`,
    )
  }

  for (const [name, column] of columns) {
    if (!SUPPORTED_TYPES.has(column.type)) {
      throw new ParquetTargetError(
        PQ_ERR.UNSUPPORTED_TYPE,
        `parquetTarget: table '${table.table}' column '${name}' has unsupported type '${column.type}'. ` +
          `Supported types: ${[...SUPPORTED_TYPES].join(', ')}.`,
      )
    }
    if (column.compression && !SUPPORTED_CODECS.has(column.compression)) {
      throw new ParquetTargetError(
        PQ_ERR.UNSUPPORTED_COMPRESSION,
        `parquetTarget: table '${table.table}' column '${name}' declares unsupported compression ` +
          `'${column.compression}'. Supported codecs: ${[...SUPPORTED_CODECS].join(', ')}.`,
      )
    }
  }

  const blockColumn = blockColumnOf(table)
  const declared = table.schema[blockColumn]
  if (!declared) {
    throw new ParquetTargetError(
      PQ_ERR.BLOCK_COLUMN_MISSING,
      `parquetTarget: table '${table.table}' schema does not include the block-number column ` +
        `'${blockColumn}'. Add it to the schema as an integer column (INT64), or set ` +
        `blockNumberColumn to the column that carries the block number.`,
    )
  }
  if (!INTEGER_BLOCK_TYPES.has(declared.type)) {
    throw new ParquetTargetError(
      PQ_ERR.BLOCK_COLUMN_TYPE,
      `parquetTarget: table '${table.table}' block-number column '${blockColumn}' has type ` +
        `'${declared.type}', but must be an integer type (${[...INTEGER_BLOCK_TYPES].join(', ')}).`,
    )
  }
  if (declared.optional) {
    throw new ParquetTargetError(
      PQ_ERR.BLOCK_COLUMN_OPTIONAL,
      `parquetTarget: table '${table.table}' block-number column '${blockColumn}' is declared optional, ` +
        `but it must carry a block number on every row — finalization, file-range naming and crash recovery ` +
        `all key off it. A null block coerces to 0 (written as an immutable block-0 row) and a missing one to ` +
        `NaN (buffered forever, silently lost). Remove 'optional: true' from this column.`,
    )
  }
}

/**
 * Translates a validated {@link ParquetTable} schema into the library-shaped object handed to
 * `new ParquetSchema(...)`, filling in the per-column compression default.
 */
export function toParquetSchemaShape(table: ParquetTable, defaultCodec: Codec): ParquetSchemaShape {
  const shape: ParquetSchemaShape = {}
  for (const [name, column] of Object.entries(table.schema)) {
    shape[name] = {
      type: column.type,
      optional: column.optional ?? false,
      compression: column.compression ?? defaultCodec,
    }
  }

  return shape
}
