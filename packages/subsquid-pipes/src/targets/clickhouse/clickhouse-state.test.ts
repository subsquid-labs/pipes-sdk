import { describe, expect, it, vi } from 'vitest'

import { BatchContext } from '~/core/index.js'
import { createTestLogger } from '~/testing/index.js'

import { ClickhouseState } from './clickhouse-state.js'

/**
 * Unit tests for the finalized-head wiring in ClickhouseState, using a mocked store (no live
 * ClickHouse). `getCursor` hands the persisted finalized head back as resume state so the source
 * can seed its monotonic watermark; `saveCursor` persists the (already source-clamped) finalized
 * head + rollback chain verbatim. The clamp itself lives in the source now.
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

function makeStore(persistedFinalized: { number: number; hash: string }) {
  const inserts: any[] = []
  const store = {
    client: { connectionParams: { database: 'default' } },
    query: async () => ({
      json: async () => [{ current: JSON.stringify(block(50)), finalized: JSON.stringify(persistedFinalized) }],
    }),
    insert: async (args: any) => {
      inserts.push(args)
    },
    removeAllRowsByQuery: async () => {},
    command: async () => {},
  }

  return { store, inserts }
}

describe('ClickhouseState — options', () => {
  it('falls back to the default id when an explicit `undefined` is passed', () => {
    const { store } = makeStore(block(100))
    const state = new ClickhouseState(store as any, { id: undefined })

    // getCursor/cleanup/fork bind {id:String}; an undefined id would break that binding.
    expect(state.options.id).toBe('stream')
  })
})

describe('ClickhouseState — resume state & cursor persistence', () => {
  it('returns the persisted cursor and finalized head as TargetState', async () => {
    const { store } = makeStore(block(100))
    const state = new ClickhouseState(store as any, {})

    const resume = await state.getCursor()

    expect(resume).toEqual({ latest: block(50), finalized: block(100) })
  })

  it('persists the finalized head + rollback chain verbatim (the source already clamped them)', async () => {
    const { store, inserts } = makeStore(block(100))
    const state = new ClickhouseState(store as any, {})

    await state.saveCursor(ctxFor(block(130), block(120), [block(121)]))

    const row = inserts[0].values[0]
    expect(row.current).toBe(JSON.stringify(block(130)))
    expect(row.finalized).toBe(JSON.stringify(block(120)))
    expect(row.rollback_chain).toBe(JSON.stringify([block(121)]))
  })

  it('persists the empty sentinel when there is no finalized head', async () => {
    const { store, inserts } = makeStore(block(100))
    const state = new ClickhouseState(store as any, {})

    await state.saveCursor(ctxFor(block(130), undefined, []))

    const row = inserts[0].values[0]
    expect(row.finalized).toBe('')
    expect(row.rollback_chain).toBe(JSON.stringify([]))
  })
})

describe('ClickhouseState — fork', () => {
  function forkStore(rows: { rollback_chain: string; finalized: string }[]) {
    const queries: any[] = []
    const store = {
      client: { connectionParams: { database: 'default' } },
      query: async (args: any) => {
        queries.push(args)
        return {
          stream: async function* () {
            yield rows.map((r) => ({ json: () => r }))
          },
        }
      },
    }
    return { store, queries }
  }

  it('scopes the fork scan to its own stream id', async () => {
    const { store, queries } = forkStore([
      { rollback_chain: JSON.stringify([block(5), block(6)]), finalized: JSON.stringify(block(4)) },
    ])
    const state = new ClickhouseState(store as any, { id: 'pipe-a' })

    await state.fork([block(5), block(6, '0x6a')])

    // Must filter by id, like getCursor/cleanup — otherwise other streams sharing the table
    // would mix their rollback chains into this fork resolution.
    expect(queries[0].query).toMatch(/WHERE id = \{id:String\}/)
    expect(queries[0].query_params).toEqual({ id: 'pipe-a' })
  })

  it('skips offsets with no finalized head instead of crashing (matches postgres/bigquery)', async () => {
    // A source that never reported a finalized head persists finalized as '' with an empty
    // rollback chain; fork resolution must skip it gracefully, not crash on JSON.parse('').
    const { store } = forkStore([{ rollback_chain: '[]', finalized: '' }])
    const state = new ClickhouseState(store as any, {})

    await expect(state.fork([block(5)])).resolves.toBeNull()
  })

  it('resolves normally when finalized heads are present', async () => {
    const { store } = forkStore([
      { rollback_chain: JSON.stringify([block(5), block(6)]), finalized: JSON.stringify(block(4)) },
    ])
    const state = new ClickhouseState(store as any, {})

    const safe = await state.fork([block(5), block(6, '0x6a')])
    expect(safe).toEqual(block(5))
  })
})

describe('ClickhouseState — cursor key binding', () => {
  // Store whose `query` returns the row registered for the queried id, so we can assert which id
  // getCursor/saveCursor actually key by.
  function keyedStore(rowsById: Record<string, { current: string; finalized: string }>) {
    const inserts: any[] = []
    const store = {
      client: { connectionParams: { database: 'default' } },
      query: async ({ query_params }: any) => {
        const row = rowsById[query_params?.id]
        return { json: async () => (row ? [row] : []) }
      },
      insert: async (args: any) => {
        inserts.push(args)
      },
      removeAllRowsByQuery: async () => {},
      command: async () => {},
    }

    return { store, inserts }
  }

  const row = (current: number, finalized: number) => ({
    current: JSON.stringify(block(current)),
    finalized: JSON.stringify(block(finalized)),
  })

  it('keys by the source id when no explicit settings.id is set', async () => {
    const { store, inserts } = keyedStore({ 'pipe-x': row(50, 40) })
    const state = new ClickhouseState(store as any, {})
    state.bindCursorKey('pipe-x')

    expect(state.cursorKey).toBe('pipe-x')
    await expect(state.getCursor()).resolves.toEqual({ latest: block(50), finalized: block(40) })

    await state.saveCursor(ctxFor(block(60), block(55), []))
    expect(inserts[0].values[0].id).toBe('pipe-x')
  })

  it('lets an explicit settings.id override the source id', async () => {
    const { store } = keyedStore({ pinned: row(10, 5) })
    const state = new ClickhouseState(store as any, { id: 'pinned' })
    state.bindCursorKey('pipe-x')

    expect(state.cursorKey).toBe('pinned')
    await expect(state.getCursor()).resolves.toEqual({ latest: block(10), finalized: block(5) })
  })

  it('does NOT read the legacy "stream" cursor by default (no migrateFromId)', async () => {
    // Safety: a new pipe sharing a table with leftover "stream" rows must start fresh, never
    // inherit a foreign cursor.
    const { store } = keyedStore({ stream: row(99, 90) })
    const state = new ClickhouseState(store as any, {})
    state.bindCursorKey('pipe-x')

    await expect(state.getCursor()).resolves.toBeUndefined()
  })

  it('migrates once from `migrateFromId` when the pipe has no cursor yet, and warns', async () => {
    const { store, inserts } = keyedStore({ stream: row(99, 90) })
    const warn = vi.fn()
    const state = new ClickhouseState(store as any, { migrateFromId: 'stream' })
    state.bindCursorKey('pipe-x', { warn } as any)

    await expect(state.getCursor()).resolves.toEqual({ latest: block(99), finalized: block(90) })
    expect(warn).toHaveBeenCalledOnce()

    // The next save rewrites under the current key, not the migrated-from id.
    await state.saveCursor(ctxFor(block(100), block(95), []))
    expect(inserts[0].values[0].id).toBe('pipe-x')
  })

  it("prefers the pipe's own cursor over `migrateFromId` once it exists", async () => {
    const { store } = keyedStore({ 'pipe-x': row(200, 190), stream: row(99, 90) })
    const state = new ClickhouseState(store as any, { migrateFromId: 'stream' })
    state.bindCursorKey('pipe-x')

    await expect(state.getCursor()).resolves.toEqual({ latest: block(200), finalized: block(190) })
  })

  it('ignores a self-referential `migrateFromId` (equal to the cursor key)', async () => {
    const { store } = keyedStore({ stream: row(99, 90) })
    const state = new ClickhouseState(store as any, { migrateFromId: 'stream' })
    state.bindCursorKey('stream')

    expect(state.cursorKey).toBe('stream')
    await expect(state.getCursor()).resolves.toEqual({ latest: block(99), finalized: block(90) })
  })
})

describe('ClickhouseState — fork migration fallback', () => {
  function forkKeyedStore(rowsById: Record<string, { rollback_chain: string; finalized: string }[]>) {
    const queries: any[] = []
    const store = {
      client: { connectionParams: { database: 'default' } },
      query: async (args: any) => {
        queries.push(args)
        const rows = rowsById[args.query_params?.id] ?? []

        return {
          stream: async function* () {
            if (rows.length) yield rows.map((r) => ({ json: () => r }))
          },
        }
      },
    }

    return { store, queries }
  }

  const chain = [{ rollback_chain: JSON.stringify([block(5), block(6)]), finalized: JSON.stringify(block(4)) }]

  it('scans the `migrateFromId` rollback chain when the pipe has no rows yet', async () => {
    const { store, queries } = forkKeyedStore({ stream: chain })
    const state = new ClickhouseState(store as any, { migrateFromId: 'stream' })
    state.bindCursorKey('pipe-x')

    const safe = await state.fork([block(5), block(6, '0x6a')])
    expect(safe).toEqual(block(5))

    // First scans 'pipe-x' (empty), then falls back to the migrateFromId 'stream'.
    expect(queries.map((q) => q.query_params.id)).toEqual(['pipe-x', 'stream'])
  })

  it('does not fall back once the pipe has its own rows', async () => {
    const { store, queries } = forkKeyedStore({
      'pipe-x': chain,
      stream: [{ rollback_chain: JSON.stringify([block(9)]), finalized: JSON.stringify(block(8)) }],
    })
    const state = new ClickhouseState(store as any, { migrateFromId: 'stream' })
    state.bindCursorKey('pipe-x')

    const safe = await state.fork([block(5), block(6, '0x6a')])
    expect(safe).toEqual(block(5))
    expect(queries.map((q) => q.query_params.id)).toEqual(['pipe-x'])
  })

  it('does not fall back without migrateFromId (safe default)', async () => {
    const { store, queries } = forkKeyedStore({ stream: chain })
    const state = new ClickhouseState(store as any, {})
    state.bindCursorKey('pipe-x')

    await expect(state.fork([block(5), block(6, '0x6a')])).resolves.toBeNull()
    expect(queries.map((q) => q.query_params.id)).toEqual(['pipe-x'])
  })
})
