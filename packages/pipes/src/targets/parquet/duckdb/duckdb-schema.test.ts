import { describe, expect, it } from 'vitest'

import { PARQUET_ERROR_CODES, ParquetTargetError } from '../errors.js'
import type { ParquetColumns, ParquetTable } from '../schema.js'
import { acquireDuckdbInstance, loadDuckdbApi } from './duckdb-engine.js'
import {
  buildCreateTableSql,
  buildRowAppender,
  columnDdlType,
  escapeSqlString,
  validateDuckdbTableCompression,
} from './duckdb-schema.js'

describe('duckdb-schema', () => {
  describe('columnDdlType', () => {
    it('maps every leaf type to its DuckDB DDL type', () => {
      expect(columnDdlType({ type: 'INT64' })).toBe('BIGINT')
      expect(columnDdlType({ type: 'INT32' })).toBe('INTEGER')
      expect(columnDdlType({ type: 'UTF8' })).toBe('VARCHAR')
      expect(columnDdlType({ type: 'BYTE_ARRAY' })).toBe('BLOB')
      expect(columnDdlType({ type: 'BOOLEAN' })).toBe('BOOLEAN')
      expect(columnDdlType({ type: 'DOUBLE' })).toBe('DOUBLE')
      // TIMESTAMP_MS ⇒ COPY writes converted_type TIMESTAMP_MILLIS, same as @dsnp/parquetjs.
      expect(columnDdlType({ type: 'TIMESTAMP' })).toBe('TIMESTAMP_MS')
      expect(columnDdlType({ type: 'DATE' })).toBe('DATE')
      // JSON alias type ⇒ COPY writes converted_type JSON, same as @dsnp/parquetjs.
      expect(columnDdlType({ type: 'JSON' })).toBe('JSON')
    })

    it('maps LIST and STRUCT recursively', () => {
      expect(columnDdlType({ type: 'LIST', element: { type: 'UTF8' } })).toBe('VARCHAR[]')
      expect(columnDdlType({ type: 'STRUCT', fields: { to: { type: 'UTF8' }, amt: { type: 'INT64' } } })).toBe(
        'STRUCT("to" VARCHAR, "amt" BIGINT)',
      )
      expect(columnDdlType({ type: 'LIST', element: { type: 'LIST', element: { type: 'INT32' } } })).toBe('INTEGER[][]')
      expect(
        columnDdlType({
          type: 'LIST',
          element: { type: 'STRUCT', fields: { to: { type: 'UTF8' }, amt: { type: 'INT64' } } },
        }),
      ).toBe('STRUCT("to" VARCHAR, "amt" BIGINT)[]')
    })
  })

  describe('buildCreateTableSql', () => {
    it('quotes table and column identifiers, doubling embedded quotes', () => {
      expect(buildCreateTableSql('seg_000001', { 'we"ird': { type: 'INT64' }, hash: { type: 'UTF8' } })).toBe(
        'CREATE TABLE "seg_000001" ("we""ird" BIGINT, "hash" VARCHAR)',
      )
    })
  })

  describe('escapeSqlString', () => {
    it('doubles single quotes so paths interpolate safely', () => {
      expect(escapeSqlString("/tmp/o'brien/x.parquet")).toBe("/tmp/o''brien/x.parquet")
    })
  })

  describe('validateDuckdbTableCompression', () => {
    const table = (schema: ParquetTable['schema']): ParquetTable => ({ table: 't', schema })

    it('accepts columns without a per-column codec, or matching the file codec', () => {
      expect(() =>
        validateDuckdbTableCompression(
          table({ blockNumber: { type: 'INT64' }, hash: { type: 'UTF8', compression: 'SNAPPY' } }),
          'SNAPPY',
        ),
      ).not.toThrow()
    })

    it('rejects a per-column codec that differs from the file codec, naming the nested path', () => {
      expect.assertions(2)
      try {
        validateDuckdbTableCompression(
          table({
            blockNumber: { type: 'INT64' },
            nested: {
              type: 'LIST',
              element: { type: 'STRUCT', fields: { x: { type: 'UTF8', compression: 'GZIP' } } },
            },
          }),
          'SNAPPY',
        )
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.DUCKDB_COLUMN_COMPRESSION)
        expect((e as ParquetTargetError).message).toMatch(/nested\[\]\.x/)
      }
    })
  })
})

describe('buildRowAppender', () => {
  it('appends every leaf/nested shape and round-trips values through a DuckDB table', async () => {
    const api = await loadDuckdbApi()
    const instance = await acquireDuckdbInstance()
    const connection = await instance.connect()

    const columns: ParquetColumns = {
      blockNumber: { type: 'INT64' },
      count: { type: 'INT32', optional: true },
      hash: { type: 'UTF8' },
      raw: { type: 'BYTE_ARRAY', optional: true },
      ok: { type: 'BOOLEAN' },
      price: { type: 'DOUBLE' },
      at: { type: 'TIMESTAMP' },
      day: { type: 'DATE' },
      meta: { type: 'JSON', optional: true },
      tags: { type: 'LIST', element: { type: 'UTF8', optional: true }, optional: true },
      user: { type: 'STRUCT', fields: { name: { type: 'UTF8' }, age: { type: 'INT32', optional: true } } },
      xfers: { type: 'LIST', element: { type: 'STRUCT', fields: { to: { type: 'UTF8' }, amt: { type: 'INT64' } } } },
      matrix: { type: 'LIST', element: { type: 'LIST', element: { type: 'INT32' } }, optional: true },
    }

    try {
      await connection.run(buildCreateTableSql('appender_rt', columns))
      const appender = await connection.createAppender('appender_rt')
      const writeRow = buildRowAppender(api, columns)(appender)

      writeRow({
        blockNumber: 1n,
        count: 7,
        hash: '0x1',
        raw: Buffer.from('deadbeef', 'hex'),
        ok: true,
        price: 1.5,
        at: new Date('2024-01-01T15:30:45.123Z'),
        day: new Date('2024-01-01T15:30:00Z'), // non-midnight → UTC calendar day 19723
        meta: { fee: 12, keys: ['k1', 'k2'] },
        tags: ['a', null, 'c'],
        user: { name: 'alice', age: 30 },
        xfers: [{ to: '0xa', amt: 5n }],
        matrix: [[1, 2], [3]],
      })
      writeRow({
        blockNumber: 2, // number input for INT64
        count: null,
        hash: '0x2',
        raw: null,
        ok: false,
        price: -2.25,
        at: 1704123045999, // epoch-millis input for TIMESTAMP
        day: 19724, // whole-days input for DATE
        meta: null,
        tags: [],
        user: { name: 'bob' }, // missing optional nested field → NULL
        xfers: [],
        matrix: null,
      })
      appender.flushSync()
      appender.closeSync()

      const result = await connection.runAndReadAll('SELECT * FROM "appender_rt" ORDER BY "blockNumber"')
      const [r1, r2] = result.getRowObjects()

      expect(r1['blockNumber']).toBe(1n)
      expect(r1['count']).toBe(7)
      expect(r1['hash']).toBe('0x1')
      expect(Array.from((r1['raw'] as { bytes: Uint8Array }).bytes)).toEqual([0xde, 0xad, 0xbe, 0xef])
      expect(r1['ok']).toBe(true)
      expect(r1['price']).toBe(1.5)
      // TIMESTAMP_MS reads back through DuckDB's millis-based timestamp wrapper.
      expect((r1['at'] as { millis: bigint }).millis).toBe(1704123045123n)
      expect((r1['day'] as { days: number }).days).toBe(19723)
      expect(r1['meta']).toBe('{"fee":12,"keys":["k1","k2"]}')
      expect((r1['tags'] as { items: unknown[] }).items).toEqual(['a', null, 'c'])
      expect((r1['user'] as { entries: unknown }).entries).toEqual({ name: 'alice', age: 30 })
      const xfers = (r1['xfers'] as { items: { entries: Record<string, unknown> }[] }).items
      expect(xfers).toHaveLength(1)
      expect(xfers[0].entries).toEqual({ to: '0xa', amt: 5n })
      const matrix = (r1['matrix'] as { items: { items: unknown[] }[] }).items
      expect(matrix.map((inner) => inner.items)).toEqual([[1, 2], [3]])

      expect(r2['blockNumber']).toBe(2n)
      expect(r2['count']).toBeNull()
      expect(r2['raw']).toBeNull()
      expect((r2['at'] as { millis: bigint }).millis).toBe(1704123045999n)
      expect((r2['day'] as { days: number }).days).toBe(19724)
      expect(r2['meta']).toBeNull()
      expect((r2['tags'] as { items: unknown[] }).items).toEqual([])
      expect((r2['user'] as { entries: unknown }).entries).toEqual({ name: 'bob', age: null })
      expect(r2['matrix']).toBeNull()

      await connection.run('DROP TABLE "appender_rt"')
    } finally {
      connection.disconnectSync()
    }
  })
})
