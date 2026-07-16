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
