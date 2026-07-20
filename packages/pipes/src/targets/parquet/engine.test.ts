import { describe, expect, it } from 'vitest'

import { type ParquetEngine, resolveEngine } from './engine.js'
import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'

describe('resolveEngine', () => {
  it('defaults to the parquetjs engine', () => {
    expect(resolveEngine(undefined).name).toBe('parquetjs')
  })

  it('maps the built-in engine names', () => {
    expect(resolveEngine('parquetjs').name).toBe('parquetjs')
    expect(resolveEngine('duckdb').name).toBe('duckdb')
  })

  it('passes a ParquetEngine implementation through untouched', () => {
    const custom: ParquetEngine = {
      name: 'custom',
      table: () => ({
        createSegment: () => {
          throw new Error('unused')
        },
      }),
    }

    expect(resolveEngine(custom)).toBe(custom)
  })

  it('rejects unknown names and malformed values with ENGINE_INVALID', () => {
    for (const bad of ['sqlite', {}, 42, null]) {
      let error: unknown
      try {
        resolveEngine(bad as never)
      } catch (caught) {
        error = caught
      }

      expect(error).toBeInstanceOf(ParquetTargetError)
      expect((error as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.ENGINE_INVALID)
    }
  })
})
