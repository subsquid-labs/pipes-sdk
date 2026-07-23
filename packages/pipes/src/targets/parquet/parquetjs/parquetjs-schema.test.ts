import { describe, expect, it } from 'vitest'

import type { ParquetTable } from '../schema.js'
import { buildRowWrapper, toParquetSchemaShape } from './parquetjs-schema.js'

const BLOCKS_TABLE: ParquetTable = {
  table: 'blocks',
  schema: {
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  },
}

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
