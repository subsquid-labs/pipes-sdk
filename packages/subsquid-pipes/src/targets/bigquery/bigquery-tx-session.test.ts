import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BigQuerySession, terminateDanglingSession } from './bigquery-tx-session.js'

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
