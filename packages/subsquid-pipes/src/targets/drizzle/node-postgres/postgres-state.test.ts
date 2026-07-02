import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { BatchContext } from '~/core/index.js'
import { createTestLogger } from '~/testing/index.js'

import { PostgresState } from './postgres-state.js'

/**
 * Unit tests for the finalized-head wiring in PostgresState, using a mocked pg client +
 * transaction (no live Postgres). `getCursor` hands the persisted finalized head back as resume
 * state so the source can seed its monotonic watermark; `saveCursor` persists the (already
 * source-clamped) finalized head + rollback chain verbatim. The clamp itself lives in the source.
 */

function block(number: number, hash = `0x${number}`) {
  return { number, hash }
}

function fakeSpan(): any {
  const span: any = {
    measure: (_name: any, fn: any) => fn(span),
    start: () => span,
    end: () => {},
  }
  return span
}

function ctxFor(
  current: { number: number; hash: string },
  finalized: { number: number; hash: string } | undefined,
  rollbackChain: { number: number; hash: string }[],
): BatchContext {
  return {
    logger: createTestLogger(),
    profiler: fakeSpan(),
    stream: {
      head: { finalized },
      state: { current, rollbackChain },
    },
  } as unknown as BatchContext
}

/** Extract the values bound into a captured drizzle SQL template. */
function paramsOf(sql: any): unknown[] {
  return new PgDialect().sqlToQuery(sql).params
}

/** Render a captured drizzle SQL template to its parameterised text. */
function sqlTextOf(sql: any): string {
  return new PgDialect().sqlToQuery(sql).sql
}

async function seededState(persistedFinalized: unknown) {
  const client = {
    query: async () => ({
      rows: [
        {
          id: 'stream',
          current_number: '50',
          current_hash: '0x50',
          current_timestamp: null,
          finalized: persistedFinalized,
          rollback_chain: [],
        },
      ],
    }),
  }
  const state = new PostgresState(client as any, { unfinalizedBlocksRetention: 1000 })
  await state.getCursor({ logger: createTestLogger() })

  return state
}

describe('PostgresState — resume state & cursor persistence', () => {
  it('returns the persisted cursor and finalized head as TargetState', async () => {
    const state = await seededState(block(100))

    const resume = await state.getCursor({ logger: createTestLogger() })

    expect(resume).toEqual({ latest: { number: 50, hash: '0x50' }, finalized: block(100) })
  })

  it('returns finalized: null when no finalized head was persisted', async () => {
    const state = await seededState({})

    const resume = await state.getCursor({ logger: createTestLogger() })

    expect(resume).toEqual({ latest: { number: 50, hash: '0x50' }, finalized: null })
  })

  it('persists the finalized head + rollback chain verbatim (the source already clamped them)', async () => {
    const state = await seededState(block(100))

    const executed: any[] = []
    const tx = {
      execute: async (sql: any) => {
        executed.push(sql)
        return { rowCount: 0 }
      },
    }

    await state.saveCursor(tx as any, ctxFor(block(130), block(120), [block(121), block(122)]))

    const insertParams = paramsOf(executed[0])
    expect(insertParams).toContain(JSON.stringify(block(120)))
    expect(insertParams).toContain(JSON.stringify([block(121), block(122)]))
  })
})

describe('PostgresState — fork', () => {
  function forkState(rows: { rollback_chain: unknown; finalized: unknown }[]) {
    let call = 0
    const client = {
      // fork() paginates; serve the rows on the first page, then an empty page to terminate.
      query: async () => {
        const page = call === 0 ? rows : []
        call++

        return { rows: page }
      },
    }

    return new PostgresState(client as any, {})
  }

  it('resolves the safe cursor from the persisted rollback chains', async () => {
    const state = forkState([{ rollback_chain: [block(5), block(6)], finalized: block(4) }])

    const safe = await state.fork([block(5), block(6, '0x6a')])

    expect(safe).toEqual(block(5))
  })

  it('skips offsets with no finalized head ({}) without crashing', async () => {
    // A source that never reported a finalized head persists `{}` with an empty rollback chain;
    // fork resolution must skip it gracefully (jsonb, so no JSON.parse crash), like ClickHouse.
    const state = forkState([{ rollback_chain: [], finalized: {} }])

    await expect(state.fork([block(5)])).resolves.toBeNull()
  })
})

describe('PostgresState — cursor key binding', () => {
  it('keys reads and saves by the source id when no explicit id is set', async () => {
    const queries: { params?: unknown[] }[] = []
    const client = {
      query: async (_text: string, params?: unknown[]) => {
        queries.push({ params })

        return { rows: [] }
      },
    }
    const state = new PostgresState(client as any, {})
    state.bindCursorKey('pipe-x')

    expect(state.cursorKey).toBe('pipe-x')

    await state.getCursor({ logger: createTestLogger() })
    expect(queries[0].params).toEqual(['pipe-x'])

    const executed: any[] = []
    const tx = {
      execute: async (sql: any) => {
        executed.push(sql)
        return { rowCount: 0 }
      },
    }
    await state.saveCursor(tx as any, ctxFor(block(130), block(120), []))
    expect(paramsOf(executed[0])).toContain('pipe-x')
  })

  it('lets an explicit options.id override the source id', () => {
    const state = new PostgresState({ query: async () => ({ rows: [] }) } as any, { id: 'pinned' })
    state.bindCursorKey('pipe-x')

    expect(state.cursorKey).toBe('pinned')
  })

  it('falls back to the default key when no source id is bound', () => {
    const state = new PostgresState({ query: async () => ({ rows: [] }) } as any, {})
    state.bindCursorKey(undefined)

    expect(state.cursorKey).toBe('stream')
  })
})

describe('PostgresState — fork cleanup', () => {
  it('deletes the now-dead sync rows above the fork cursor', async () => {
    const state = await seededState(block(100))

    const executed: any[] = []
    const tx = {
      execute: async (sql: any) => {
        executed.push(sql)
        return { rowCount: 0 }
      },
    }

    await state.removeForkedRows(tx as any, block(997))

    const text = sqlTextOf(executed[0])
    const params = paramsOf(executed[0])
    // Scope to this id and drop only rows strictly above the safe cursor (the dead chain),
    // so the resume row stays the last write and reprocessing can re-insert those numbers.
    expect(text).toMatch(/DELETE FROM/i)
    expect(text).toMatch(/"current_number" > \$\d/)
    expect(params).toEqual(['stream', 997])
  })
})
