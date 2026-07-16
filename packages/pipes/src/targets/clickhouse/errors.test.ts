import { describe, expect, it } from 'vitest'

import { PipeError } from '~/core/errors.js'

import { ClickhouseStore } from './clickhouse-store.js'
import { CLICKHOUSE_ERROR_CODES, ClickhouseTargetError } from './errors.js'

describe('ClickhouseTargetError', () => {
  it('carries the given E20xx code and a docs link', () => {
    const err = new ClickhouseTargetError(CLICKHOUSE_ERROR_CODES.MAX_ROWS, 'boom')

    expect(err).toBeInstanceOf(PipeError)
    expect(err.code).toBe('E2001')
    expect(err.message).toContain('boom')
    expect(err.message).toContain('See: https://docs.sqd.dev/en/sdk/pipes-sdk/errors/E2001')
  })

  // These validations fire before any client call, so a stub client is enough to reach them.
  const store = new ClickhouseStore({} as any)

  it('rejects a non-identifier rollback index column (E2006)', async () => {
    try {
      await store.ensureRollbackIndex({ table: 't', column: 'bad col' })
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ClickhouseTargetError)
      expect((e as ClickhouseTargetError).code).toBe(CLICKHOUSE_ERROR_CODES.INVALID_ROLLBACK_INDEX_COLUMN)
    }
  })

  it('rejects an unparseable table name (E2002)', async () => {
    try {
      await store.ensureRollbackIndex({ table: 'a.b.c', column: 'block_number' })
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(ClickhouseTargetError)
      expect((e as ClickhouseTargetError).code).toBe(CLICKHOUSE_ERROR_CODES.INVALID_TABLE_NAME)
    }
  })
})
