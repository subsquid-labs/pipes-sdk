import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import { ParquetStore } from './parquet-store.js'
import { parquetjsEngine } from './parquetjs/parquetjs-engine.js'
import type { ParquetTable } from './schema.js'

const BLOCKS_TABLE: ParquetTable = {
  table: 'blocks',
  schema: {
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  },
}

describe('ParquetStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-parquet-store-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('dev-mode value validation', () => {
    const bytesTable: ParquetTable = {
      table: 't',
      schema: { blockNumber: { type: 'INT64' }, raw: { type: 'BYTE_ARRAY' } },
    }

    it('rejects a hex string handed to a BYTE_ARRAY column', () => {
      const store = new ParquetStore({
        dir,
        tables: [bytesTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      expect.assertions(1)
      try {
        store.insert('t', [{ blockNumber: 1, raw: '0xdeadbeef' }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.VALUE_INVALID)
      }
    })

    it('rejects an INT64 number above 2^53 (precision already lost)', () => {
      const store = new ParquetStore({
        dir,
        tables: [BLOCKS_TABLE],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      expect.assertions(1)
      try {
        store.insert('blocks', [{ blockNumber: 2 ** 53, hash: '0x1', timestamp: 1 }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.VALUE_INVALID)
      }
    })

    it('accepts a Buffer for BYTE_ARRAY and a bigint for INT64', () => {
      const store = new ParquetStore({
        dir,
        tables: [bytesTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      expect(() => store.insert('t', [{ blockNumber: 1n, raw: Buffer.from('deadbeef', 'hex') }])).not.toThrow()
    })

    const stampsTable: ParquetTable = {
      table: 'stamps',
      schema: {
        blockNumber: { type: 'INT64' },
        at: { type: 'TIMESTAMP' },
        day: { type: 'DATE', optional: true },
        meta: { type: 'JSON', optional: true },
      },
    }

    it('accepts Date/epoch-millis TIMESTAMP, Date/integer-days/null DATE and JSON-serializable values', () => {
      const store = new ParquetStore({
        dir,
        tables: [stampsTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      expect(() =>
        store.insert('stamps', [
          {
            blockNumber: 1,
            at: new Date('2024-01-01T15:30:00Z'),
            day: new Date('2024-01-01T15:30:00Z'),
            meta: { a: [1, 'x'] },
          },
          { blockNumber: 2, at: 1704122400000, day: 19723, meta: 'plain string is valid JSON' },
          { blockNumber: 3, at: new Date('2024-01-01T15:30:00Z'), day: null, meta: null },
        ]),
      ).not.toThrow()
    })

    it('rejects fractional, negative, epoch-millis-magnitude and pre-1970 DATE values', () => {
      const store = new ParquetStore({
        dir,
        tables: [stampsTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      // 19723.5: not whole days; -1: the library rejects negatives; 1704067200000: epoch millis
      // passed by mistake (would crash the int32 encoder at flush time); pre-1970 Date: the
      // library truncates toward zero, landing on the wrong day.
      const bad = [19723.5, -1, 1704067200000, new Date('1969-12-31T12:00:00Z')]
      expect.assertions(4)
      for (const day of bad) {
        try {
          store.insert('stamps', [{ blockNumber: 1, at: new Date(0), day }])
        } catch (e) {
          expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.VALUE_INVALID)
        }
      }
    })

    it('rejects JSON values the writer cannot serialize (bigint, circular)', () => {
      const store = new ParquetStore({
        dir,
        tables: [stampsTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      const circular: Record<string, unknown> = {}
      circular['self'] = circular
      // The library would crash mid-flush with a context-free "Do not know how to serialize a
      // BigInt" — the dev check surfaces the table/column instead.
      const bad = [{ amount: 5n }, circular]
      expect.assertions(2)
      for (const meta of bad) {
        try {
          store.insert('stamps', [{ blockNumber: 1, at: new Date(0), meta }])
        } catch (e) {
          expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.VALUE_INVALID)
        }
      }
    })

    const nestedTable: ParquetTable = {
      table: 'n',
      schema: {
        blockNumber: { type: 'INT64' },
        user: { type: 'STRUCT', fields: { name: { type: 'UTF8' }, age: { type: 'INT32', optional: true } } },
        tags: { type: 'LIST', element: { type: 'UTF8' }, optional: true },
      },
    }

    it('accepts plain nested objects for STRUCT and plain arrays for LIST', () => {
      const store = new ParquetStore({
        dir,
        tables: [nestedTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      expect(() =>
        store.insert('n', [
          { blockNumber: 1, user: { name: 'alice', age: 30 }, tags: ['a', 'b'] },
          { blockNumber: 2, user: { name: 'bob', age: null }, tags: [] },
          { blockNumber: 3, user: { name: 'eve' }, tags: null },
        ]),
      ).not.toThrow()
    })

    it('rejects bad nested values with the offending path in the message', () => {
      const store = new ParquetStore({
        dir,
        tables: [nestedTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      // [row, expected message fragment]: scalar where a struct object is expected; missing
      // required nested field; non-array LIST; null element under a required element decl;
      // wrong element type.
      const cases: [Record<string, unknown>, RegExp][] = [
        [{ blockNumber: 1, user: 'oops', tags: null }, /user.*expects a plain object/],
        [{ blockNumber: 1, user: { age: 1 }, tags: null }, /user\.name.*required/],
        [{ blockNumber: 1, user: { name: 'a' }, tags: 'x,y' }, /tags.*expects an array/],
        [{ blockNumber: 1, user: { name: 'a' }, tags: ['ok', null] }, /tags\[1\].*required/],
        [{ blockNumber: 1, user: { name: 'a' }, tags: [42] }, /tags\[0\].*expects a string/],
      ]
      expect.assertions(2 * cases.length)
      for (const [row, fragment] of cases) {
        try {
          store.insert('n', [row])
        } catch (e) {
          expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.VALUE_INVALID)
          expect((e as ParquetTargetError).message).toMatch(fragment)
        }
      }
    })

    it('rejects Map and Set STRUCT values (entries are invisible to property access)', () => {
      const store = new ParquetStore({
        dir,
        tables: [nestedTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      // The writer shreds structs via `value[field]`, so Map/Set entries read as undefined:
      // required fields fail with a misleading "required but undefined" and optional fields
      // silently write null — reject the container itself instead.
      const cases: unknown[] = [new Map([['name', 'alice']]), new Set(['alice'])]
      expect.assertions(2 * cases.length)
      for (const user of cases) {
        try {
          store.insert('n', [{ blockNumber: 1, user, tags: null }])
        } catch (e) {
          expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.VALUE_INVALID)
          expect((e as ParquetTargetError).message).toMatch(/user.*expects a plain object/)
        }
      }
    })

    it('accepts class instances and null-prototype objects for STRUCT', () => {
      const store = new ParquetStore({
        dir,
        tables: [nestedTable],
        rowGroupSize: 1,
        defaultCodec: 'SNAPPY',
        engine: parquetjsEngine(),
      })
      // Both expose their fields to property access, so they write correctly — the STRUCT
      // check must not tighten to a prototype test that would reject them.
      class User {
        name = 'alice'
      }
      const nullProto = Object.assign(Object.create(null), { name: 'bob' })

      expect(() =>
        store.insert('n', [
          { blockNumber: 1, user: new User(), tags: null },
          { blockNumber: 2, user: nullProto, tags: null },
        ]),
      ).not.toThrow()
    })
  })
})
