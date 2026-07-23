import type { Codec, ParquetColumn, ParquetColumns, ParquetLeafType, ParquetTable } from '../schema.js'

/**
 * Leaf type strings as `@dsnp/parquetjs` expects them: the public union minus `'TIMESTAMP'`,
 * which the pinned library only knows by its legacy `TIMESTAMP_MILLIS` name.
 */
export type LibraryLeafType = Exclude<ParquetLeafType, 'TIMESTAMP'> | 'TIMESTAMP_MILLIS'

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

// Public → library leaf type names. Exhaustive over ParquetLeafType (compile-checked by the
// Record type), so adding a leaf type in schema.ts without mapping it here fails to compile.
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
