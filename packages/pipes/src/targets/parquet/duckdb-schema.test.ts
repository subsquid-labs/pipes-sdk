import { describe, expect, it } from 'vitest'

import {
  buildCreateTableSql,
  columnDdlType,
  escapeSqlString,
  validateDuckdbColumnCompression,
} from './duckdb-schema.js'
import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import type { ParquetTable } from './schema.js'

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

  describe('validateDuckdbColumnCompression', () => {
    const table = (schema: ParquetTable['schema']): ParquetTable => ({ table: 't', schema })

    it('accepts columns without a per-column codec, or matching the file codec', () => {
      expect(() =>
        validateDuckdbColumnCompression(
          [table({ blockNumber: { type: 'INT64' }, hash: { type: 'UTF8', compression: 'SNAPPY' } })],
          'SNAPPY',
        ),
      ).not.toThrow()
    })

    it('rejects a per-column codec that differs from the file codec, naming the nested path', () => {
      expect.assertions(2)
      try {
        validateDuckdbColumnCompression(
          [
            table({
              blockNumber: { type: 'INT64' },
              nested: {
                type: 'LIST',
                element: { type: 'STRUCT', fields: { x: { type: 'UTF8', compression: 'GZIP' } } },
              },
            }),
          ],
          'SNAPPY',
        )
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.DUCKDB_COLUMN_COMPRESSION)
        expect((e as ParquetTargetError).message).toMatch(/nested\[\]\.x/)
      }
    })
  })
})
