import { describe, expect, it } from 'vitest'

import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import { type ParquetTable, buildRowWrapper, toParquetSchemaShape, validateTables } from './schema.js'

const BLOCKS_TABLE: ParquetTable = {
  table: 'blocks',
  schema: {
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  },
}

describe('schema validation', () => {
  it('rejects an empty tables list', () => {
    expect.assertions(1)
    try {
      validateTables([])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.NO_TABLES)
    }
  })

  it('rejects a schema missing the block-number column', () => {
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { hash: { type: 'UTF8' } } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.BLOCK_COLUMN_MISSING)
    }
  })

  it('rejects a non-integer block-number column', () => {
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { blockNumber: { type: 'UTF8' } } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.BLOCK_COLUMN_TYPE)
    }
  })

  it('rejects duplicate table names', () => {
    expect.assertions(1)
    try {
      validateTables([BLOCKS_TABLE, BLOCKS_TABLE])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.DUPLICATE_TABLE)
    }
  })

  it('rejects an empty schema', () => {
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: {} }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.EMPTY_SCHEMA)
    }
  })

  it('rejects an unsupported column type', () => {
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { blockNumber: { type: 'INT64' }, amount: { type: 'DECIMAL' as never } } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.UNSUPPORTED_TYPE)
    }
  })

  it('rejects an unsupported compression codec', () => {
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { blockNumber: { type: 'INT64', compression: 'ZSTD' as never } } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.UNSUPPORTED_COMPRESSION)
    }
  })

  it('accepts TIMESTAMP, DATE and JSON as column types', () => {
    expect(() =>
      validateTables([
        {
          table: 't',
          schema: {
            blockNumber: { type: 'INT64' },
            at: { type: 'TIMESTAMP' },
            day: { type: 'DATE' },
            meta: { type: 'JSON', optional: true },
          },
        },
      ]),
    ).not.toThrow()
  })

  it('rejects TIMESTAMP as the block-number column', () => {
    // Epoch-ms, not a block number — finalization comparisons would never release rows.
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { blockNumber: { type: 'TIMESTAMP' } } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.BLOCK_COLUMN_TYPE)
    }
  })

  it('rejects DATE as the block-number column', () => {
    // Days-since-epoch, not a block number — finalization comparisons would never release rows.
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { blockNumber: { type: 'DATE' } } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.BLOCK_COLUMN_TYPE)
    }
  })

  it('rejects JSON as the block-number column', () => {
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { blockNumber: { type: 'JSON' } } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.BLOCK_COLUMN_TYPE)
    }
  })

  it('rejects an optional block-number column', () => {
    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { blockNumber: { type: 'INT64', optional: true } } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.BLOCK_COLUMN_OPTIONAL)
    }
  })

  it('accepts STRUCT and LIST columns, nested arbitrarily', () => {
    expect(() =>
      validateTables([
        {
          table: 't',
          schema: {
            blockNumber: { type: 'INT64' },
            user: { type: 'STRUCT', fields: { name: { type: 'UTF8' }, age: { type: 'INT32', optional: true } } },
            tags: { type: 'LIST', element: { type: 'UTF8', optional: true }, optional: true },
            xfers: {
              type: 'LIST',
              element: { type: 'STRUCT', fields: { to: { type: 'UTF8' }, amt: { type: 'INT64' } } },
            },
            wrapped: { type: 'STRUCT', fields: { inner: { type: 'LIST', element: { type: 'INT32' } } } },
          },
        },
      ]),
    ).not.toThrow()
  })

  it('rejects STRUCT and LIST as the block-number column', () => {
    expect.assertions(2)
    for (const decl of [
      { type: 'STRUCT', fields: { x: { type: 'INT64' } } },
      { type: 'LIST', element: { type: 'INT64' } },
    ] as const) {
      try {
        validateTables([{ table: 't', schema: { blockNumber: decl as never } }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.BLOCK_COLUMN_TYPE)
      }
    }
  })

  it('rejects malformed nested declarations (empty STRUCT, LIST without element, bad nested leaf)', () => {
    expect.assertions(3)
    // Plain-JS configs can be malformed in ways TS would reject — validate at runtime.
    const cases: { schema: Record<string, unknown>; code: string }[] = [
      {
        schema: { blockNumber: { type: 'INT64' }, u: { type: 'STRUCT', fields: {} } },
        code: PARQUET_ERROR_CODES.NESTED_SCHEMA_INVALID,
      },
      {
        schema: { blockNumber: { type: 'INT64' }, l: { type: 'LIST' } },
        code: PARQUET_ERROR_CODES.NESTED_SCHEMA_INVALID,
      },
      {
        schema: { blockNumber: { type: 'INT64' }, u: { type: 'STRUCT', fields: { d: { type: 'DECIMAL' } } } },
        code: PARQUET_ERROR_CODES.UNSUPPORTED_TYPE,
      },
    ]
    for (const { schema, code } of cases) {
      try {
        validateTables([{ table: 't', schema: schema as never }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(code)
      }
    }
  })

  it('rejects nullish and non-object column declarations with table/path context', () => {
    // Without a shape guard these crash reading `column.type` on null/undefined — a bare
    // TypeError with no error code, table name or column path.
    const cases: { schema: Record<string, unknown>; at: string }[] = [
      { schema: { blockNumber: { type: 'INT64' }, bad: null }, at: 'bad' },
      { schema: { blockNumber: { type: 'INT64' }, u: { type: 'STRUCT', fields: { bad: null } } }, at: 'u.bad' },
      { schema: { blockNumber: { type: 'INT64' }, u: { type: 'STRUCT', fields: { bad: undefined } } }, at: 'u.bad' },
      { schema: { blockNumber: { type: 'INT64' }, l: { type: 'LIST', element: 'INT64' } }, at: 'l[]' },
    ]
    expect.assertions(2 * cases.length)
    for (const { schema, at } of cases) {
      try {
        validateTables([{ table: 't', schema: schema as never }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.NESTED_SCHEMA_INVALID)
        expect((e as ParquetTargetError).message).toContain(`'${at}'`)
      }
    }
  })

  it('rejects schemas nested beyond the depth cap (cyclic declarations)', () => {
    // A cyclic JS schema object would recurse forever without the depth cap.
    const cyclic: Record<string, unknown> = { type: 'STRUCT' }
    cyclic['fields'] = { self: cyclic }

    expect.assertions(1)
    try {
      validateTables([{ table: 't', schema: { blockNumber: { type: 'INT64' }, u: cyclic as never } }])
    } catch (e) {
      expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.NESTED_SCHEMA_INVALID)
    }
  })
})

describe('schema translation', () => {
  it('emits the canonical 3-level LIST shape and maps TIMESTAMP to the library name', () => {
    const table: ParquetTable = {
      table: 't',
      schema: {
        blockNumber: { type: 'INT64' },
        at: { type: 'TIMESTAMP' },
        tags: { type: 'LIST', element: { type: 'UTF8', optional: true }, optional: true },
        user: { type: 'STRUCT', fields: { name: { type: 'UTF8' } } },
      },
    }

    expect(toParquetSchemaShape(table, 'SNAPPY')).toEqual({
      blockNumber: { type: 'INT64', optional: false, compression: 'SNAPPY' },
      at: { type: 'TIMESTAMP_MILLIS', optional: false, compression: 'SNAPPY' },
      tags: {
        type: 'LIST',
        optional: true,
        fields: {
          list: {
            repeated: true,
            fields: { element: { type: 'UTF8', optional: true, compression: 'SNAPPY' } },
          },
        },
      },
      user: {
        optional: false,
        fields: { name: { type: 'UTF8', optional: false, compression: 'SNAPPY' } },
      },
    })
  })
})

describe('list row wrapping', () => {
  it('returns undefined for schemas without lists (zero-cost path)', () => {
    expect(buildRowWrapper(BLOCKS_TABLE.schema)).toBeUndefined()
    expect(
      buildRowWrapper({
        blockNumber: { type: 'INT64' },
        user: { type: 'STRUCT', fields: { name: { type: 'UTF8' } } },
      }),
    ).toBeUndefined()
  })

  it('wraps plain arrays into { list: [{ element }] }, recursing into structs and nested lists', () => {
    const wrap = buildRowWrapper({
      blockNumber: { type: 'INT64' },
      tags: { type: 'LIST', element: { type: 'UTF8', optional: true }, optional: true },
      xfers: { type: 'LIST', element: { type: 'STRUCT', fields: { to: { type: 'UTF8' } } } },
      wrapped: {
        type: 'STRUCT',
        fields: { inner: { type: 'LIST', element: { type: 'INT32' } }, keep: { type: 'INT32' } },
      },
    })!

    const row = {
      blockNumber: 1,
      tags: ['a', null],
      xfers: [{ to: '0xa' }],
      wrapped: { inner: [7], keep: 3 },
    }
    expect(wrap(row)).toEqual({
      blockNumber: 1,
      tags: { list: [{ element: 'a' }, { element: null }] },
      xfers: { list: [{ element: { to: '0xa' } }] },
      wrapped: { inner: { list: [{ element: 7 }] }, keep: 3 },
    })
    // The input row must not be mutated — its objects belong to the caller.
    expect(row.tags).toEqual(['a', null])
    expect(row.wrapped).toEqual({ inner: [7], keep: 3 })
  })

  it('passes null/empty lists through in the shapes the writer expects', () => {
    const wrap = buildRowWrapper({
      blockNumber: { type: 'INT64' },
      tags: { type: 'LIST', element: { type: 'UTF8' }, optional: true },
    })!

    expect(wrap({ blockNumber: 1, tags: null })).toEqual({ blockNumber: 1, tags: null })
    expect(wrap({ blockNumber: 1, tags: [] })).toEqual({ blockNumber: 1, tags: { list: [] } })
  })
})
