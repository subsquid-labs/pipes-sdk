import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'

/**
 * Compression codecs supported by `@dsnp/parquetjs` (verified by the Step 0 spike against
 * the pinned version — the library also recognises the *names* `LZO`/`LZ4`/`ZSTD` but throws
 * `Unsupported compression method` at write time, so they are intentionally excluded here).
 */
export type Codec = 'UNCOMPRESSED' | 'SNAPPY' | 'GZIP' | 'BROTLI'

/**
 * Parquet leaf (primitive/logical) column types exposed by this target. This is our own union —
 * the public API carries **no compile-time dependency** on `@dsnp/parquetjs` types; the strings
 * are translated to the library's `ParquetSchema` internally (see {@link toParquetSchemaShape}).
 *
 * JS → Parquet input contract (what `onData` must put in each row), per the Step 0 spike:
 * - `INT64`      ← `number` **or** `bigint` (reads back as `bigint`)
 * - `INT32`      ← `number`
 * - `DOUBLE`     ← `number`
 * - `BOOLEAN`    ← `boolean`
 * - `UTF8`       ← `string` (store hashes/addresses here for human-readable columns)
 * - `BYTE_ARRAY` ← `Buffer` / `Uint8Array` (a hex string must be `Buffer.from(hex, 'hex')`)
 * - `TIMESTAMP`  ← `Date` **or** `number` (epoch millis; reads back as `Date`)
 * - `DATE`       ← `Date` (stored as its UTC calendar day, 1970+ only) **or** `number` (whole
 *                  days since the Unix epoch, ≥ 0; reads back as `Date` at UTC midnight)
 * - `JSON`       ← any `JSON.stringify`-able value (plain objects/arrays/strings/numbers —
 *                  **not** `bigint`; reads back parsed)
 * - any column with `optional: true` may also be `null` / `undefined`
 *
 * On the wire (verified by spike against the pinned writer library) `TIMESTAMP` is an `int64`
 * annotated with the legacy `TIMESTAMP_MILLIS` converted type, `DATE` an `int32` annotated
 * `DATE`, and `JSON` a `BYTE_ARRAY` annotated `JSON` — the library predates the modern
 * LogicalType footer field, and the format spec's backward-compatibility rules make readers
 * interpret these as `TIMESTAMP(isAdjustedToUTC = true, unit = MILLIS)`, `DATE` and `JSON`
 * logical types respectively.
 *
 * `DECIMAL` is intentionally unsupported — use `UTF8` or a scaled `INT64` instead.
 */
export type ParquetLeafType =
  | 'INT64'
  | 'INT32'
  | 'UTF8'
  | 'BYTE_ARRAY'
  | 'BOOLEAN'
  | 'DOUBLE'
  | 'TIMESTAMP'
  | 'DATE'
  | 'JSON'

/** Every string accepted in a column's `type` field, including the nested kinds. */
export type ParquetColumnType = ParquetLeafType | 'LIST' | 'STRUCT'

/**
 * Leaf type strings as `@dsnp/parquetjs` expects them: the public union minus `'TIMESTAMP'`,
 * which the pinned library only knows by its legacy `TIMESTAMP_MILLIS` name.
 */
export type LibraryLeafType = Exclude<ParquetLeafType, 'TIMESTAMP'> | 'TIMESTAMP_MILLIS'

/**
 * Declaration for a single Parquet column: a leaf, a `LIST` (spec-canonical 3-level layout;
 * rows carry a plain JS array) or a `STRUCT` group (rows carry a plain nested object).
 * `LIST` and `STRUCT` nest arbitrarily; `compression` applies to leaves only (groups are
 * structural and carry no data pages).
 */
export type ParquetColumn =
  | {
      type: ParquetLeafType
      /** Allow `null`/`undefined` for this column. Defaults to `false` (required). */
      optional?: boolean
      /** Per-column compression codec. Defaults to the target's `settings.compression` (`'SNAPPY'`). */
      compression?: Codec
    }
  | {
      type: 'LIST'
      /** Declaration of the list's element (a leaf, STRUCT, or another LIST). */
      element: ParquetColumn
      /** Allow `null`/`undefined` for the whole list. An empty array is always allowed. */
      optional?: boolean
    }
  | {
      type: 'STRUCT'
      /** Nested field declarations. Must be non-empty. */
      fields: ParquetColumns
      /** Allow `null`/`undefined` for the whole group. */
      optional?: boolean
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

/**
 * The library-shaped schema tree (our type) handed to `new ParquetSchema(...)` by the writer.
 * Groups have `fields` (and `type: 'LIST'` for list annotations); leaves have a `type` and
 * `compression`; the `list`/`element` inner nodes of a LIST follow the canonical 3-level
 * layout the Parquet spec mandates for list annotations.
 */
export type ParquetFieldShape = {
  type?: LibraryLeafType | 'LIST'
  optional?: boolean
  repeated?: boolean
  compression?: Codec
  fields?: Record<string, ParquetFieldShape>
}

export type ParquetSchemaShape = Record<string, ParquetFieldShape>

export const DEFAULT_BLOCK_COLUMN = 'blockNumber'
export const DEFAULT_CODEC: Codec = 'SNAPPY'

const SUPPORTED_CODECS = new Set<string>(['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'BROTLI'])

// Public → library leaf type names. Single source of truth for which leaf types are supported:
// validation checks membership of its keys, and `toParquetSchemaShape` applies the mapping.
const LIBRARY_TYPE: Record<ParquetLeafType, LibraryLeafType> = {
  INT64: 'INT64',
  INT32: 'INT32',
  UTF8: 'UTF8',
  BYTE_ARRAY: 'BYTE_ARRAY',
  BOOLEAN: 'BOOLEAN',
  DOUBLE: 'DOUBLE',
  TIMESTAMP: 'TIMESTAMP_MILLIS',
  DATE: 'DATE',
  JSON: 'JSON',
}

const SUPPORTED_TYPES = new Set<string>(Object.keys(LIBRARY_TYPE))

// The block column's value is compared directly against the portal's finalized block NUMBER
// (`Number(row[col]) <= finalized.number`) to decide when a row may leave the finalization buffer,
// so it must hold the block number itself. TIMESTAMP (and its TIMESTAMP_MILLIS alias) is
// int64-backed but carries epoch-ms, and DATE is int32-backed but carries days-since-epoch —
// comparing either against a block number silently never (or always) finalizes, so both are
// excluded, as is everything non-numeric.
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
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.NO_TABLES,
      'parquetTarget: `tables` must declare at least one table.',
    )
  }

  const seen = new Set<string>()
  for (const table of tables) {
    if (seen.has(table.table)) {
      throw new ParquetTargetError(
        PARQUET_ERROR_CODES.DUPLICATE_TABLE,
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
      PARQUET_ERROR_CODES.EMPTY_SCHEMA,
      `parquetTarget: table '${table.table}' has an empty schema. Declare at least one column.`,
    )
  }

  for (const [name, column] of columns) {
    validateColumn(table.table, name, column, 0)
  }

  const blockColumn = blockColumnOf(table)
  const declared = table.schema[blockColumn]
  if (!declared) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.BLOCK_COLUMN_MISSING,
      `parquetTarget: table '${table.table}' schema does not include the block-number column ` +
        `'${blockColumn}'. Add it to the schema as an integer column (INT64), or set ` +
        `blockNumberColumn to the column that carries the block number.`,
    )
  }
  if (!INTEGER_BLOCK_TYPES.has(declared.type)) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.BLOCK_COLUMN_TYPE,
      `parquetTarget: table '${table.table}' block-number column '${blockColumn}' has type ` +
        `'${declared.type}', but must be an integer type (${[...INTEGER_BLOCK_TYPES].join(', ')}).`,
    )
  }
  if (declared.optional) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.BLOCK_COLUMN_OPTIONAL,
      `parquetTarget: table '${table.table}' block-number column '${blockColumn}' is declared optional, ` +
        `but it must carry a block number on every row — finalization, file-range naming and crash recovery ` +
        `all key off it. A null block coerces to 0 (written as an immutable block-0 row) and a missing one to ` +
        `NaN (buffered forever, silently lost). Remove 'optional: true' from this column.`,
    )
  }
}

// Deep nesting is legal in Parquet, but a runaway/cyclic JS config would recurse forever —
// cap well above any sane schema.
const MAX_NESTING_DEPTH = 32

/** Recursively validates one column declaration (leaf, LIST or STRUCT) at `path`. */
function validateColumn(table: string, path: string, column: ParquetColumn, depth: number): void {
  if (depth > MAX_NESTING_DEPTH) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.NESTED_SCHEMA_INVALID,
      `parquetTarget: table '${table}' column '${path}' exceeds ${MAX_NESTING_DEPTH} nesting levels — ` +
        `is the schema object cyclic?`,
    )
  }

  // A nullish or primitive declaration (possible in plain-JS configs) would otherwise crash
  // on `column.type` below with a context-free TypeError.
  if (column == null || typeof column !== 'object') {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.NESTED_SCHEMA_INVALID,
      `parquetTarget: table '${table}' column '${path}' declaration must be an object like ` +
        `{ type: 'INT64' }, got ${typeof column === 'string' ? `'${column}'` : String(column)}.`,
    )
  }

  if (column.type === 'STRUCT') {
    const fields = Object.entries(column.fields ?? {})
    if (fields.length === 0) {
      throw new ParquetTargetError(
        PARQUET_ERROR_CODES.NESTED_SCHEMA_INVALID,
        `parquetTarget: table '${table}' STRUCT column '${path}' must declare at least one field.`,
      )
    }
    for (const [name, child] of fields) {
      validateColumn(table, `${path}.${name}`, child, depth + 1)
    }

    return
  }

  if (column.type === 'LIST') {
    if (!column.element) {
      throw new ParquetTargetError(
        PARQUET_ERROR_CODES.NESTED_SCHEMA_INVALID,
        `parquetTarget: table '${table}' LIST column '${path}' must declare an 'element'.`,
      )
    }
    validateColumn(table, `${path}[]`, column.element, depth + 1)

    return
  }

  if (!SUPPORTED_TYPES.has(column.type)) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.UNSUPPORTED_TYPE,
      `parquetTarget: table '${table}' column '${path}' has unsupported type '${column.type}'. ` +
        `Supported leaf types: ${[...SUPPORTED_TYPES].join(', ')}, plus 'LIST' and 'STRUCT'.`,
    )
  }
  if (column.compression && !SUPPORTED_CODECS.has(column.compression)) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.UNSUPPORTED_COMPRESSION,
      `parquetTarget: table '${table}' column '${path}' declares unsupported compression ` +
        `'${column.compression}'. Supported codecs: ${[...SUPPORTED_CODECS].join(', ')}.`,
    )
  }
}

/**
 * Translates a validated {@link ParquetTable} schema into the library-shaped tree handed to
 * `new ParquetSchema(...)`, filling in the per-leaf compression default. LIST columns expand
 * to the spec-canonical 3-level layout (`LIST` group → repeated `list` → `element`), which is
 * why rows must be wrapped before writing (see {@link buildRowWrapper}).
 */
export function toParquetSchemaShape(table: ParquetTable, defaultCodec: Codec): ParquetSchemaShape {
  const shape: ParquetSchemaShape = {}
  for (const [name, column] of Object.entries(table.schema)) {
    shape[name] = toFieldShape(column, defaultCodec)
  }

  return shape
}

function toFieldShape(column: ParquetColumn, defaultCodec: Codec): ParquetFieldShape {
  if (column.type === 'STRUCT') {
    const fields: Record<string, ParquetFieldShape> = {}
    for (const [name, child] of Object.entries(column.fields)) {
      fields[name] = toFieldShape(child, defaultCodec)
    }

    return { optional: column.optional ?? false, fields }
  }

  if (column.type === 'LIST') {
    return {
      type: 'LIST',
      optional: column.optional ?? false,
      fields: {
        list: {
          repeated: true,
          fields: { element: toFieldShape(column.element, defaultCodec) },
        },
      },
    }
  }

  return {
    type: LIBRARY_TYPE[column.type],
    optional: column.optional ?? false,
    compression: column.compression ?? defaultCodec,
  }
}

type Row = Record<string, unknown>

/**
 * {@link toParquetSchemaShape} expands every LIST to the spec-canonical 3-level layout, so the
 * rows handed to the writer must nest list values as `{ list: [{ element: v }] }` — a plain JS
 * array is rejected by the library ("too many values for field"). Rather than leak that shape
 * into `onData`, rows keep plain arrays and this wrapper (compiled once per table) rewrites them
 * right before the write. Returns `undefined` when the schema declares no LIST anywhere, so
 * list-free tables keep the zero-copy path.
 */
export function buildRowWrapper(columns: ParquetColumns): ((row: Row) => Row) | undefined {
  const wrappers = new Map<string, (value: unknown) => unknown>()
  for (const [name, column] of Object.entries(columns)) {
    const wrap = buildValueWrapper(column)
    if (wrap) wrappers.set(name, wrap)
  }
  if (wrappers.size === 0) return undefined

  return (row) => {
    const out: Row = { ...row }
    for (const [name, wrap] of wrappers) {
      const value = out[name]
      if (value != null) out[name] = wrap(value)
    }

    return out
  }
}

/** Wrapper for one declaration's values, or `undefined` if its subtree contains no LIST. */
function buildValueWrapper(column: ParquetColumn): ((value: unknown) => unknown) | undefined {
  if (column.type === 'LIST') {
    const wrapElement = buildValueWrapper(column.element)

    return (value) => ({
      list: (value as unknown[]).map((element) =>
        element != null && wrapElement ? { element: wrapElement(element) } : { element },
      ),
    })
  }

  if (column.type === 'STRUCT') {
    const inner = buildRowWrapper(column.fields)

    return inner ? (value) => inner(value as Row) : undefined
  }

  return undefined
}
