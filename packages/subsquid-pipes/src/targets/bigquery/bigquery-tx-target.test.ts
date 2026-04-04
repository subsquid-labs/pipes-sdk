import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { evmPortalStream } from '~/evm/index.js'
import { MockPortal, createMockPortal } from '~/testing/index.js'
import { blockDecoder } from '~/testing/test-block-stream.js'

import { bigqueryTransactionalTarget } from './bigquery-tx-target.js'

// ---------------------------------------------------------------------------
// Mock BigQuery factory
// ---------------------------------------------------------------------------

function tempPath() {
  return join(tmpdir(), `bq-tx-target-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
}

type MockBqOpts = {
  /** Rows returned by the cursor SELECT query.  Defaults to [] (fresh start). */
  cursorRows?: { cursor: string }[]
}

function makeMockBq(opts: MockBqOpts = {}) {
  const sessionId = 'mock-session-id'

  const mockJob = {
    getMetadata: vi.fn().mockResolvedValue([
      { statistics: { sessionInfo: { sessionId } } },
    ]),
  }

  const queryCalls: string[] = []

  const bq = {
    createQueryJob: vi.fn().mockResolvedValue([mockJob]),
    query: vi.fn().mockImplementation(async ({ query }: { query: string }) => {
      queryCalls.push(query)
      // cursor SELECT
      if (query.startsWith('SELECT cursor FROM')) {
        return [opts.cursorRows ?? []]
      }
      return [[]]
    }),
  }

  return { bq, mockJob, queryCalls }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let sessionFile: string
let mockPortal: MockPortal | undefined

function cleanup() {
  try { if (sessionFile) unlinkSync(sessionFile) } catch { /* already gone */ }
}

beforeEach(() => {
  sessionFile = tempPath()
})

afterEach(async () => {
  await mockPortal?.close()
  mockPortal = undefined
  cleanup()
})

// ---------------------------------------------------------------------------
// Basic lifecycle
// ---------------------------------------------------------------------------

describe('bigqueryTransactionalTarget lifecycle', () => {
  it('calls onStart, creates state table, then processes a batch', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
        head: { finalized: { number: 1, hash: '0x1' } },
      },
    ])

    const { bq, queryCalls } = makeMockBq()
    const onStartCalls: string[] = []
    const onDataCalls: number[] = []

    await evmPortalStream({
      id: 'test',
      portal: mockPortal.url,
      outputs: blockDecoder({ from: 0, to: 1 }),
    }).pipeTo(
      bigqueryTransactionalTarget({
        bigquery: bq as any,
        dataset: 'my_dataset',
        settings: { sessionFile },
        onStart: ({ logger }) => {
          onStartCalls.push('start')
        },
        onData: async ({ session, data }) => {
          onDataCalls.push(data.length)
        },
      }),
    )

    expect(onStartCalls).toEqual(['start'])
    expect(onDataCalls).toEqual([1])

    // State table DDL was issued
    expect(queryCalls.some((q) => q.includes('CREATE TABLE IF NOT EXISTS'))).toBe(true)

    // Cursor save MERGE was issued via session (confirmed by createQueryJob being called once)
    expect(bq.createQueryJob).toHaveBeenCalledOnce()

    // Session committed: COMMIT TRANSACTION call present
    const sessionQueryCalls = bq.query.mock.calls.filter((args: any[]) =>
      args[0].connectionProperties?.some((p: any) => p.key === 'session_id'),
    )
    expect(sessionQueryCalls.some((args: any[]) => args[0].query === 'COMMIT TRANSACTION')).toBe(true)

    // Session file cleaned up after commit
    expect(existsSync(sessionFile)).toBe(false)
  })

  it('creates one session per batch', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
        head: { finalized: { number: 1, hash: '0x1' } },
      },
      {
        statusCode: 200,
        data: [{ header: { number: 2, hash: '0x2', timestamp: 2000 } }],
        head: { finalized: { number: 2, hash: '0x2' } },
      },
    ])

    const { bq } = makeMockBq()

    await evmPortalStream({
      id: 'test',
      portal: {
        url: mockPortal.url,
        maxBytes: 1, // force one batch per response
      },
      outputs: blockDecoder({ from: 0, to: 2 }),
    }).pipeTo(
      bigqueryTransactionalTarget({
        bigquery: bq as any,
        dataset: 'my_dataset',
        settings: { sessionFile },
        onData: async () => {},
      }),
    )

    expect(bq.createQueryJob).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// offset_check rollback
// ---------------------------------------------------------------------------

describe('offset_check rollback', () => {
  it('fires onRollback with offset_check when cursor exists on startup', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 5, hash: '0x5', timestamp: 5000 } }],
        head: { finalized: { number: 5, hash: '0x5' } },
      },
    ])

    const existingCursor = JSON.stringify({ number: 4, hash: '0x4' })
    const { bq } = makeMockBq({ cursorRows: [{ cursor: existingCursor }] })

    const rollbackCalls: { type: string; number: number }[] = []

    await evmPortalStream({
      id: 'test',
      portal: mockPortal.url,
      outputs: blockDecoder({ from: 0, to: 5 }),
    }).pipeTo(
      bigqueryTransactionalTarget({
        bigquery: bq as any,
        dataset: 'my_dataset',
        settings: { sessionFile },
        onData: async () => {},
        onRollback: ({ type, safeCursor }) => {
          rollbackCalls.push({ type, number: safeCursor.number })
        },
      }),
    )

    expect(rollbackCalls).toEqual([{ type: 'offset_check', number: 4 }])
  })

  it('does not fire onRollback when no cursor exists', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
        head: { finalized: { number: 1, hash: '0x1' } },
      },
    ])

    const { bq } = makeMockBq() // no cursorRows → fresh start

    const rollbackCalls: string[] = []

    await evmPortalStream({
      id: 'test',
      portal: mockPortal.url,
      outputs: blockDecoder({ from: 0, to: 1 }),
    }).pipeTo(
      bigqueryTransactionalTarget({
        bigquery: bq as any,
        dataset: 'my_dataset',
        settings: { sessionFile },
        onData: async () => {},
        onRollback: ({ type }) => {
          rollbackCalls.push(type)
        },
      }),
    )

    expect(rollbackCalls).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Dangling session cleanup on startup
// ---------------------------------------------------------------------------

describe('dangling session cleanup', () => {
  it('terminates a dangling session before onStart', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
        head: { finalized: { number: 1, hash: '0x1' } },
      },
    ])

    // Pre-populate the session file to simulate a prior crash
    writeFileSync(sessionFile, 'dangling-session-id', 'utf8')

    const { bq, queryCalls } = makeMockBq()
    const callOrder: string[] = []

    bq.query = vi.fn().mockImplementation(async ({ query }: { query: string }) => {
      queryCalls.push(query)
      if (query.includes('ABORT_SESSION')) callOrder.push('abort_session')
      if (query.includes('CREATE TABLE')) callOrder.push('create_table')
      if (query.startsWith('SELECT cursor')) return [[]]
      return [[]]
    })

    await evmPortalStream({
      id: 'test',
      portal: mockPortal.url,
      outputs: blockDecoder({ from: 0, to: 1 }),
    }).pipeTo(
      bigqueryTransactionalTarget({
        bigquery: bq as any,
        dataset: 'my_dataset',
        settings: { sessionFile },
        onStart: () => { callOrder.push('on_start') },
        onData: async () => {},
      }),
    )

    // Dangling session was aborted before anything else
    expect(callOrder[0]).toBe('abort_session')
    expect(callOrder).toContain('on_start')
    expect(callOrder.indexOf('abort_session')).toBeLessThan(callOrder.indexOf('on_start'))
  })
})

// ---------------------------------------------------------------------------
// Rollback on onData error
// ---------------------------------------------------------------------------

describe('session rollback on error', () => {
  it('rolls back and rethrows when onData throws', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
        head: { finalized: { number: 1, hash: '0x1' } },
      },
    ])

    const { bq } = makeMockBq()

    await expect(
      evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 1 }),
      }).pipeTo(
        bigqueryTransactionalTarget({
          bigquery: bq as any,
          dataset: 'my_dataset',
          settings: { sessionFile },
          onData: async () => {
            throw new Error('write failed')
          },
        }),
      ),
    ).rejects.toThrow('write failed')

    // ROLLBACK TRANSACTION was issued via the session
    const rollbackCall = bq.query.mock.calls.find(
      (args: any[]) =>
        args[0].query === 'ROLLBACK TRANSACTION' &&
        args[0].connectionProperties?.some((p: any) => p.key === 'session_id'),
    )
    expect(rollbackCall).toBeDefined()

    // No COMMIT was issued
    const commitCall = bq.query.mock.calls.find(
      (args: any[]) => args[0].query === 'COMMIT TRANSACTION',
    )
    expect(commitCall).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Fork handler
// ---------------------------------------------------------------------------

describe('fork handler', () => {
  it('throws when a fork is received', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x1', timestamp: 1000 } },
          { header: { number: 2, hash: '0x2', timestamp: 2000 } },
        ],
        head: { finalized: { number: 1, hash: '0x1' } },
      },
      {
        statusCode: 409,
        data: {
          previousBlocks: [
            { number: 1, hash: '0x1' },
            { number: 2, hash: '0x2a' },
          ],
        },
      },
    ])

    const { bq } = makeMockBq()

    await expect(
      evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 3 }),
      }).pipeTo(
        bigqueryTransactionalTarget({
          bigquery: bq as any,
          dataset: 'my_dataset',
          settings: { sessionFile },
          onData: async () => {},
        }),
      ),
    ).rejects.toThrow('does not support blockchain forks')
  })
})
