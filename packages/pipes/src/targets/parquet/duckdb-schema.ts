import type {
  DuckDBAppender,
  DuckDBListType,
  DuckDBListValue,
  DuckDBStructType,
  DuckDBStructValue,
  DuckDBType,
  DuckDBValue,
} from '@duckdb/node-api'

import type { DuckdbApi } from './duckdb-engine.js'
import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import type { Codec, ParquetColumn, ParquetColumns, ParquetLeafType, ParquetTable } from './schema.js'

/**
 * SDK leaf type → DuckDB DDL type. Spike-verified against DuckDB 1.5.4: `TIMESTAMP_MS` COPYs
 * to Parquet with converted_type `TIMESTAMP_MILLIS` (the exact annotation `@dsnp/parquetjs`
 * writes for our `TIMESTAMP`), and the `JSON` alias type COPYs with converted_type `JSON`
 * (ditto). Every other entry lands on the same physical type + annotation the parquetjs
 * engine produces.
 */
const DDL_TYPE: Record<ParquetLeafType, string> = {
  INT64: 'BIGINT',
  INT32: 'INTEGER',
  UTF8: 'VARCHAR',
  BYTE_ARRAY: 'BLOB',
  BOOLEAN: 'BOOLEAN',
  DOUBLE: 'DOUBLE',
  TIMESTAMP: 'TIMESTAMP_MS',
  DATE: 'DATE',
  JSON: 'JSON',
}

/** Quotes a DuckDB identifier, doubling embedded double quotes. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/** Escapes a string for interpolation into a single-quoted SQL literal (e.g. COPY paths). */
export function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''")
}

/** DuckDB DDL type expression for one column declaration (recursive for LIST/STRUCT). */
export function columnDdlType(column: ParquetColumn): string {
  if (column.type === 'STRUCT') {
    const fields = Object.entries(column.fields)
      .map(([name, child]) => `${quoteIdent(name)} ${columnDdlType(child)}`)
      .join(', ')

    return `STRUCT(${fields})`
  }

  if (column.type === 'LIST') {
    return `${columnDdlType(column.element)}[]`
  }

  return DDL_TYPE[column.type]
}

/** `CREATE TABLE` statement for a segment staging table matching the declared columns. */
export function buildCreateTableSql(table: string, columns: ParquetColumns): string {
  const definitions = Object.entries(columns)
    .map(([name, column]) => `${quoteIdent(name)} ${columnDdlType(column)}`)
    .join(', ')

  return `CREATE TABLE ${quoteIdent(table)} (${definitions})`
}

/**
 * DuckDB's COPY writes ONE codec for the whole file, so a per-column `compression` that
 * differs from the file-level default cannot be honored — reject it loudly at construction
 * instead of silently writing a different codec than declared.
 */
export function validateDuckdbColumnCompression(tables: ParquetTable[], defaultCodec: Codec): void {
  for (const table of tables) {
    for (const [name, column] of Object.entries(table.schema)) {
      assertUniformCompression(table.table, name, column, defaultCodec)
    }
  }
}

function assertUniformCompression(table: string, path: string, column: ParquetColumn, defaultCodec: Codec): void {
  if (column.type === 'STRUCT') {
    for (const [name, child] of Object.entries(column.fields)) {
      assertUniformCompression(table, `${path}.${name}`, child, defaultCodec)
    }

    return
  }

  if (column.type === 'LIST') {
    assertUniformCompression(table, `${path}[]`, column.element, defaultCodec)

    return
  }

  if (column.compression && column.compression !== defaultCodec) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.DUCKDB_COLUMN_COMPRESSION,
      `parquetTarget: table '${table}' column '${path}' declares per-column compression ` +
        `'${column.compression}', but the duckdb engine writes a single file-level codec ` +
        `('${defaultCodec}'). Remove the per-column codec, change settings.compression, or ` +
        `use the parquetjs engine.`,
    )
  }
}

type Row = Record<string, unknown>

const MS_PER_DAY = 86_400_000

/**
 * Compiles the per-table append plan once: each column gets a typed appender call (the fast
 * path — a scalar cell costs one N-API call), with plain-JS → DuckDBValue encoding for nested
 * LIST/STRUCT columns. The outer function binds the plan to an open appender, because nested
 * appends need the appender's own column `DuckDBType`s — building a list value without its
 * type throws "item type of ANY" in the client (spike-verified).
 *
 * Input contract per cell is identical to the parquetjs engine (see {@link ParquetLeafType}):
 * rows carry PLAIN arrays/objects — never the parquetjs `{ list: [{ element }] }` wrapping.
 * `null`/`undefined` anywhere appends SQL NULL.
 */
export function buildRowAppender(
  api: DuckdbApi,
  columns: ParquetColumns,
): (appender: DuckDBAppender) => (row: Row) => void {
  const declarations = Object.entries(columns)

  return (appender) => {
    const cells = declarations.map(([name, column], index) => {
      const append = buildCellAppender(api, column, appender.columnType(index))

      return (row: Row) => {
        const value = row[name]
        if (value == null) appender.appendNull()
        else append(appender, value)
      }
    })

    return (row) => {
      for (const cell of cells) cell(row)
      appender.endRow()
    }
  }
}

/** Appender call for one non-null top-level cell of the given declared column type. */
function buildCellAppender(
  api: DuckdbApi,
  column: ParquetColumn,
  type: DuckDBType,
): (appender: DuckDBAppender, value: unknown) => void {
  switch (column.type) {
    case 'LIST': {
      const encode = buildValueEncoder(api, column)
      const listType = type as DuckDBListType

      return (appender, value) => appender.appendList(encode(value) as DuckDBListValue, listType)
    }

    case 'STRUCT': {
      const encode = buildValueEncoder(api, column)
      const structType = type as DuckDBStructType

      return (appender, value) => appender.appendStruct(encode(value) as DuckDBStructValue, structType)
    }

    case 'INT64':
      return (appender, value) => appender.appendBigInt(typeof value === 'bigint' ? value : BigInt(value as number))

    case 'INT32':
      return (appender, value) => appender.appendInteger(value as number)

    case 'UTF8':
      return (appender, value) => appender.appendVarchar(value as string)

    case 'BYTE_ARRAY':
      return (appender, value) => appender.appendBlob(value as Uint8Array)

    case 'BOOLEAN':
      return (appender, value) => appender.appendBoolean(value as boolean)

    case 'DOUBLE':
      return (appender, value) => appender.appendDouble(value as number)

    case 'TIMESTAMP':
      return (appender, value) => appender.appendTimestampMilliseconds(api.timestampMillisValue(toEpochMillis(value)))

    case 'DATE':
      return (appender, value) => appender.appendDate(api.dateValue(toEpochDays(value)))

    case 'JSON':
      return (appender, value) => appender.appendVarchar(JSON.stringify(value))
  }
}

/** Encodes one non-null value into a `DuckDBValue` for a NESTED position (inside LIST/STRUCT). */
function buildValueEncoder(api: DuckdbApi, column: ParquetColumn): (value: unknown) => DuckDBValue {
  switch (column.type) {
    case 'LIST': {
      const element = buildValueEncoder(api, column.element)

      return (value) => api.listValue((value as unknown[]).map((item) => (item == null ? null : element(item))))
    }

    case 'STRUCT': {
      const fields = Object.entries(column.fields).map(
        ([name, child]) => [name, buildValueEncoder(api, child)] as const,
      )

      return (value) => {
        const entries: Record<string, DuckDBValue> = {}
        for (const [name, encode] of fields) {
          const item = (value as Row)[name]
          entries[name] = item == null ? null : encode(item)
        }

        return api.structValue(entries)
      }
    }

    case 'INT64':
      return (value) => (typeof value === 'bigint' ? value : BigInt(value as number))

    case 'INT32':
    case 'DOUBLE':
      return (value) => value as number

    case 'UTF8':
      return (value) => value as string

    case 'BOOLEAN':
      return (value) => value as boolean

    case 'BYTE_ARRAY':
      return (value) => api.blobValue(value as Uint8Array)

    case 'TIMESTAMP':
      return (value) => api.timestampMillisValue(toEpochMillis(value))

    case 'DATE':
      return (value) => api.dateValue(toEpochDays(value))

    case 'JSON':
      return (value) => JSON.stringify(value)
  }
}

/** `TIMESTAMP` input contract: `Date` or epoch-millis number. */
function toEpochMillis(value: unknown): bigint {
  return BigInt(value instanceof Date ? value.getTime() : Math.trunc(value as number))
}

/**
 * `DATE` input contract: `Date` (stored as its UTC calendar day, 1970+ only) or a non-negative
 * integer of whole days since the Unix epoch. Truncation toward zero mirrors the parquetjs
 * engine; pre-1970 input is rejected by the dev-mode value check before it gets here.
 */
function toEpochDays(value: unknown): number {
  return value instanceof Date ? Math.trunc(value.getTime() / MS_PER_DAY) : (value as number)
}
