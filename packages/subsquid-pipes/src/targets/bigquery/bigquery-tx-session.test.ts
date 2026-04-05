import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BigQuerySession, paginateParams, terminateDanglingSession } from './bigquery-tx-session.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempPath() {
  return join(tmpdir(), `bq-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
}

function makeMockBq(overrides: {
  createQueryJobError?: Error
  sessionId?: string
  queryError?: Error
}) {
  const sessionId = overrides.sessionId ?? 'test-session-id'

  const mockJob = {
    getMetadata: vi.fn().mockResolvedValue([
      { statistics: { sessionInfo: { sessionId } } },
    ]),
  }

  const bq = {
    createQueryJob: vi.fn().mockImplementation(async () => {
      if (overrides.createQueryJobError) throw overrides.createQueryJobError
      return [mockJob]
    }),
    query: vi.fn().mockImplementation(async () => {
      if (overrides.queryError) throw overrides.queryError
      return [[]]
    }),
  }

  return { bq, mockJob }
}

// ---------------------------------------------------------------------------
// BigQuerySession.create
// ---------------------------------------------------------------------------

describe('BigQuerySession.create', () => {
  let sessionFile: string

  beforeEach(() => {
    sessionFile = tempPath()
  })

  afterEach(() => {
    try { unlinkSync(sessionFile) } catch { /* already gone */ }
  })

  it('writes session id to file before returning', async () => {
    const { bq } = makeMockBq({ sessionId: 'sess-abc' })

    const session = await BigQuerySession.create(bq as any, sessionFile)

    expect(session.sessionId).toBe('sess-abc')
    expect(existsSync(sessionFile)).toBe(true)
    expect(readFileSync(sessionFile, 'utf8')).toBe('sess-abc')
  })

  it('passes createSession: true and BEGIN TRANSACTION to createQueryJob', async () => {
    const { bq } = makeMockBq({})

    await BigQuerySession.create(bq as any, sessionFile)

    expect(bq.createQueryJob).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'BEGIN TRANSACTION', createSession: true }),
    )
  })
})

// ---------------------------------------------------------------------------
// BigQuerySession.query
// ---------------------------------------------------------------------------

describe('BigQuerySession.query', () => {
  let sessionFile: string

  beforeEach(() => {
    sessionFile = tempPath()
  })

  afterEach(() => {
    try { unlinkSync(sessionFile) } catch { /* already gone */ }
  })

  it('sends connectionProperties with session_id', async () => {
    const { bq } = makeMockBq({ sessionId: 'sess-xyz' })
    const session = await BigQuerySession.create(bq as any, sessionFile)

    await session.query('SELECT 1')

    expect(bq.query).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionProperties: [{ key: 'session_id', value: 'sess-xyz' }],
        useLegacySql: false,
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// BigQuerySession.commit
// ---------------------------------------------------------------------------

describe('BigQuerySession.commit', () => {
  let sessionFile: string

  beforeEach(() => {
    sessionFile = tempPath()
  })

  afterEach(() => {
    try { unlinkSync(sessionFile) } catch { /* already gone */ }
  })

  it('issues COMMIT TRANSACTION in-session then ABORT_SESSION and deletes file', async () => {
    const { bq } = makeMockBq({ sessionId: 'sess-commit' })
    const session = await BigQuerySession.create(bq as any, sessionFile)

    expect(existsSync(sessionFile)).toBe(true)

    await session.commit()

    // COMMIT issued via session query (has connectionProperties)
    const commitCall = bq.query.mock.calls.find(
      (args: any[]) => args[0].query === 'COMMIT TRANSACTION',
    )
    expect(commitCall).toBeDefined()
    expect(commitCall![0]).toMatchObject({
      connectionProperties: [{ key: 'session_id', value: 'sess-commit' }],
    })

    // ABORT_SESSION issued out-of-session (no connectionProperties)
    const abortCall = bq.query.mock.calls.find(
      (args: any[]) => typeof args[0].query === 'string' && args[0].query.includes('ABORT_SESSION'),
    )
    expect(abortCall).toBeDefined()
    expect(abortCall![0].connectionProperties).toBeUndefined()

    // Session file cleaned up
    expect(existsSync(sessionFile)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// BigQuerySession.rollback
// ---------------------------------------------------------------------------

describe('BigQuerySession.rollback', () => {
  let sessionFile: string

  beforeEach(() => {
    sessionFile = tempPath()
  })

  afterEach(() => {
    try { unlinkSync(sessionFile) } catch { /* already gone */ }
  })

  it('issues ROLLBACK TRANSACTION in-session then ABORT_SESSION and deletes file', async () => {
    const { bq } = makeMockBq({ sessionId: 'sess-rollback' })
    const session = await BigQuerySession.create(bq as any, sessionFile)

    expect(existsSync(sessionFile)).toBe(true)

    await session.rollback()

    const rollbackCall = bq.query.mock.calls.find(
      (args: any[]) => args[0].query === 'ROLLBACK TRANSACTION',
    )
    expect(rollbackCall).toBeDefined()
    expect(rollbackCall![0]).toMatchObject({
      connectionProperties: [{ key: 'session_id', value: 'sess-rollback' }],
    })

    expect(existsSync(sessionFile)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// terminateDanglingSession
// ---------------------------------------------------------------------------

describe('terminateDanglingSession', () => {
  let sessionFile: string

  beforeEach(() => {
    sessionFile = tempPath()
  })

  afterEach(() => {
    try { unlinkSync(sessionFile) } catch { /* already gone */ }
  })

  it('does nothing when session file does not exist', async () => {
    const { bq } = makeMockBq({})

    await terminateDanglingSession(bq as any, sessionFile)

    expect(bq.query).not.toHaveBeenCalled()
  })

  it('calls ABORT_SESSION and deletes the file when session file exists', async () => {
    writeFileSync(sessionFile, 'dangling-session-id', 'utf8')
    const { bq } = makeMockBq({})

    await terminateDanglingSession(bq as any, sessionFile)

    expect(bq.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "CALL BQ.ABORT_SESSION('dangling-session-id')",
      }),
    )
    expect(existsSync(sessionFile)).toBe(false)
  })

  it('deletes the file even when BQ returns a session-not-found error', async () => {
    writeFileSync(sessionFile, 'expired-session', 'utf8')
    const { bq } = makeMockBq({ queryError: new Error('Session not found: expired-session') })

    await terminateDanglingSession(bq as any, sessionFile)

    expect(existsSync(sessionFile)).toBe(false)
  })

  it('deletes the file even when BQ returns a session-not-active error', async () => {
    writeFileSync(sessionFile, 'stale-session', 'utf8')
    const { bq } = makeMockBq({ queryError: new Error('Session stale-session is not active') })

    await terminateDanglingSession(bq as any, sessionFile)

    expect(existsSync(sessionFile)).toBe(false)
  })

  it('re-throws unexpected BQ errors', async () => {
    writeFileSync(sessionFile, 'sess-err', 'utf8')
    const { bq } = makeMockBq({ queryError: new Error('Unexpected quota exceeded') })

    await expect(terminateDanglingSession(bq as any, sessionFile)).rejects.toThrow(
      'Unexpected quota exceeded',
    )
  })

  it('does nothing when session file is empty', async () => {
    writeFileSync(sessionFile, '', 'utf8')
    const { bq } = makeMockBq({})

    await terminateDanglingSession(bq as any, sessionFile)

    expect(bq.query).not.toHaveBeenCalled()
    expect(existsSync(sessionFile)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// paginateParams
// ---------------------------------------------------------------------------

describe('paginateParams', () => {
  it('returns the original params in a single-element array when pageSize is undefined', () => {
    const params = { a: [1, 2, 3], b: ['x', 'y', 'z'] }
    expect(paginateParams(params, undefined)).toEqual([params])
  })

  it('splits into pages of the given size', () => {
    const params = { a: [1, 2, 3, 4, 5], b: ['a', 'b', 'c', 'd', 'e'] }
    expect(paginateParams(params, 2)).toEqual([
      { a: [1, 2], b: ['a', 'b'] },
      { a: [3, 4], b: ['c', 'd'] },
      { a: [5],    b: ['e'] },
    ])
  })

  it('returns a single page when rows <= pageSize', () => {
    const params = { x: [10, 20] }
    expect(paginateParams(params, 100)).toEqual([{ x: [10, 20] }])
  })

  it('returns empty array for zero-length arrays', () => {
    expect(paginateParams({ a: [], b: [] }, 10)).toEqual([])
  })

  it('returns empty array for empty params object', () => {
    expect(paginateParams({}, 10)).toEqual([])
  })

  it('throws when pageSize is zero', () => {
    expect(() => paginateParams({ a: [1] }, 0)).toThrow('positive integer')
  })

  it('throws when pageSize is negative', () => {
    expect(() => paginateParams({ a: [1] }, -5)).toThrow('positive integer')
  })

  it('throws when pageSize is not an integer', () => {
    expect(() => paginateParams({ a: [1] }, 1.5)).toThrow('positive integer')
  })

  it('throws when arrays have different lengths', () => {
    expect(() => paginateParams({ a: [1, 2], b: ['x'] }, 10)).toThrow('same length')
  })
})

// ---------------------------------------------------------------------------
// BigQuerySession.queryPaged
// ---------------------------------------------------------------------------

describe('BigQuerySession.queryPaged', () => {
  let sessionFile: string

  beforeEach(() => { sessionFile = tempPath() })
  afterEach(() => { try { unlinkSync(sessionFile) } catch { /* already gone */ } })

  it('calls query once when pageSize is undefined', async () => {
    const { bq } = makeMockBq({})
    const session = await BigQuerySession.create(bq as any, sessionFile)

    const params = { a: [1, 2, 3] }
    await session.queryPaged('SELECT 1', params, { a: ['INT64'] }, undefined)

    // Only the BEGIN TRANSACTION implicit call + our one query
    const userCalls = bq.query.mock.calls.filter(
      (args: any[]) => args[0].query === 'SELECT 1',
    )
    expect(userCalls).toHaveLength(1)
    expect(userCalls[0][0].params).toEqual(params)
  })

  it('calls query once per page', async () => {
    const { bq } = makeMockBq({})
    const session = await BigQuerySession.create(bq as any, sessionFile)

    await session.queryPaged(
      'INSERT INTO t SELECT v FROM UNNEST(@v) AS v',
      { v: [1, 2, 3, 4, 5] },
      { v: ['INT64'] },
      2,
    )

    const insertCalls = bq.query.mock.calls.filter(
      (args: any[]) => args[0].query?.startsWith('INSERT INTO'),
    )
    expect(insertCalls).toHaveLength(3)
    expect(insertCalls[0][0].params).toEqual({ v: [1, 2] })
    expect(insertCalls[1][0].params).toEqual({ v: [3, 4] })
    expect(insertCalls[2][0].params).toEqual({ v: [5] })
  })

  it('sends no queries for empty params arrays', async () => {
    const { bq } = makeMockBq({})
    const session = await BigQuerySession.create(bq as any, sessionFile)

    await session.queryPaged('INSERT INTO t SELECT v FROM UNNEST(@v) AS v', { v: [] }, { v: ['INT64'] }, 100)

    const insertCalls = bq.query.mock.calls.filter(
      (args: any[]) => args[0].query?.startsWith('INSERT INTO'),
    )
    expect(insertCalls).toHaveLength(0)
  })
})
