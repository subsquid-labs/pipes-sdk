import { describe, expect, it } from 'vitest'

import { createTestLogger } from '~/testing/index.js'

import { BigQueryState } from './bigquery-state.js'

/**
 * Unit tests for the finalized-head wiring in BigQueryState, using a mocked store (no live
 * BigQuery). `getCursor` hands the persisted finalized head back as resume state so the source can
 * seed its monotonic watermark — the clamp itself now lives in the source (see portal-source and
 * finalized-watermark tests), not in the target.
 */

function block(number: number, hash = `0x${number}`) {
  return { number, hash }
}

function committedRow(finalized: { number: number; hash: string } | null) {
  return {
    id: 'stream',
    op: 'commit',
    current: JSON.stringify(block(50)),
    finalized: finalized ? JSON.stringify(finalized) : null,
    rollback_chain: '[]',
    range_low: null,
    range_high: null,
    committed: true,
    timestamp: 1,
  }
}

function stateWith(row: ReturnType<typeof committedRow>) {
  const store = {
    query: async () => [row],
  }

  return new BigQueryState({
    store: store as any,
    bigquery: {} as any,
    trackedTables: [],
    options: { projectId: 'p', dataset: 'd' },
  })
}

describe('BigQueryState — resume state', () => {
  it('returns the persisted cursor and finalized head as TargetState', async () => {
    const state = stateWith(committedRow(block(100)))

    const resume = await state.getCursor({ logger: createTestLogger() })

    expect(resume).toEqual({ latest: block(50), finalized: block(100) })
  })

  it('returns finalized: null when no finalized head was persisted', async () => {
    const state = stateWith(committedRow(null))

    const resume = await state.getCursor({ logger: createTestLogger() })

    expect(resume).toEqual({ latest: block(50), finalized: null })
  })
})

describe('BigQueryState — cursor key binding', () => {
  function keyedState(options: { id?: string } = {}) {
    const queryParams: any[] = []
    const walRows: any[] = []
    const store = {
      query: async (_sql: string, params?: Record<string, unknown>) => {
        queryParams.push(params)

        return []
      },
      commitSyncRow: async (_schema: unknown, row: Record<string, unknown>) => {
        walRows.push(row)
      },
      executeDml: async () => ({ rowCount: 0 }),
    }

    const state = new BigQueryState({
      store: store as any,
      bigquery: {} as any,
      trackedTables: [],
      options: { projectId: 'p', dataset: 'd', ...options },
    })

    return { state, queryParams, walRows }
  }

  it('keys reads and WAL writes by the source id when no explicit id is set', async () => {
    const { state, queryParams, walRows } = keyedState()
    state.bindCursorKey('pipe-x')

    expect(state.cursorKey).toBe('pipe-x')

    await state.getCursor({ logger: createTestLogger() })
    expect(queryParams[0]).toEqual({ id: 'pipe-x' })

    await state.saveCommitPost({
      logger: createTestLogger(),
      cursor: block(1),
      finalized: undefined,
      rollbackChain: [],
    })
    expect(walRows[0].id).toBe('pipe-x')
  })

  it('lets an explicit options.id override the source id', () => {
    const { state } = keyedState({ id: 'pinned' })
    state.bindCursorKey('pipe-x')

    expect(state.cursorKey).toBe('pinned')
  })

  it('falls back to the default key when no source id is bound', () => {
    const { state } = keyedState()
    state.bindCursorKey(undefined)

    expect(state.cursorKey).toBe('stream')
  })
})
