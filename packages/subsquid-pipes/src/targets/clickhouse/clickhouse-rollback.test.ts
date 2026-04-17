import { describe, expect, it, vi } from 'vitest'

import {
  type ColumnIntrospector,
  type RollbackTarget,
  assertScopeIsolation,
  buildMonolithicInsertSelectSql,
  buildProbeSql,
  cursorColumnIsInSortKey,
  dispatchRollback,
  extractIdentifiers,
  probeHasWorkToDo,
  resolveRollbackSettings,
  resolveTargetTable,
  runMonolithicCleanup,
  sortKeyIdentifiers,
  splitSortKeyEntries,
} from '~/targets/clickhouse/clickhouse-rollback.js'
import type { ClickhouseStore } from '~/targets/clickhouse/clickhouse-store.js'

describe('resolveRollbackSettings', () => {
  it('applies defaults when called with undefined', () => {
    const r = resolveRollbackSettings()
    expect(r).toEqual({
      targets: [],
      concurrency: 2,
      chunkSize: 500_000,
      retryBackoff: { baseMs: 250, jitter: 0.5 },
      checkpointTable: '_sqd_rollback_checkpoint',
    })
  })

  it('preserves user overrides and fills partial backoff', () => {
    const r = resolveRollbackSettings({
      targets: [{ table: 't', scopeWhere: '1' }],
      concurrency: 5,
      retryBackoff: { baseMs: 1000 },
    })
    expect(r.concurrency).toBe(5)
    expect(r.chunkSize).toBe(500_000)
    expect(r.retryBackoff).toEqual({ baseMs: 1000, jitter: 0.5 })
    expect(r.targets).toHaveLength(1)
  })
})

describe('splitSortKeyEntries', () => {
  it('splits a simple tuple with outer parens', () => {
    expect(splitSortKeyEntries('(a, b, c)')).toEqual(['a', 'b', 'c'])
  })

  it('accepts no outer parens', () => {
    expect(splitSortKeyEntries('a, b')).toEqual(['a', 'b'])
  })

  it('handles backtick-quoted identifiers containing commas-in-name', () => {
    expect(splitSortKeyEntries('(`a,b`, c)')).toEqual(['`a,b`', 'c'])
  })

  it('respects paren depth for function-call entries', () => {
    expect(splitSortKeyEntries('(toYYYYMM(ts), id)')).toEqual(['toYYYYMM(ts)', 'id'])
  })

  it('respects nested function-call paren depth', () => {
    expect(splitSortKeyEntries('(cityHash64(a, b), c)')).toEqual(['cityHash64(a, b)', 'c'])
  })
})

describe('extractIdentifiers', () => {
  it('extracts a bare identifier', () => {
    expect(Array.from(extractIdentifiers('block_number'))).toEqual(['block_number'])
  })

  it('skips function names but keeps operands', () => {
    const ids = Array.from(extractIdentifiers('toYYYYMM(ts)'))
    expect(ids).toContain('ts')
    expect(ids).not.toContain('toYYYYMM')
  })

  it('extracts backtick-quoted identifiers', () => {
    const ids = Array.from(extractIdentifiers('`weird name`'))
    expect(ids).toEqual(['weird name'])
  })

  it('extracts nested function operands', () => {
    const ids = Array.from(extractIdentifiers('cityHash64(a, b)'))
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(ids).not.toContain('cityHash64')
  })
})

describe('cursorColumnIsInSortKey (NB5 parity branches)', () => {
  it('simple accept', () => {
    expect(cursorColumnIsInSortKey('(block_number, id)', 'block_number')).toBe(true)
  })

  it('simple reject', () => {
    expect(cursorColumnIsInSortKey('(block_number, id)', 'ts')).toBe(false)
  })

  it('accepts backtick-quoted sort key entries', () => {
    expect(cursorColumnIsInSortKey('(`block_number`, id)', 'block_number')).toBe(true)
  })

  it('accepts when there are no outer parens', () => {
    expect(cursorColumnIsInSortKey('block_number, id', 'id')).toBe(true)
  })

  it('accepts identifier used as an expression operand', () => {
    expect(cursorColumnIsInSortKey('(toYYYYMM(ts), id)', 'ts')).toBe(true)
  })

  it('rejects when only the function name matches', () => {
    expect(cursorColumnIsInSortKey('(toYYYYMM(ts), id)', 'toYYYYMM')).toBe(false)
  })

  it('accepts identifier as nested function argument', () => {
    expect(cursorColumnIsInSortKey('(cityHash64(a, b), c)', 'b')).toBe(true)
  })
})

describe('sortKeyIdentifiers', () => {
  it('is the union of all entry identifiers', () => {
    const ids = sortKeyIdentifiers('(toYYYYMM(ts), `x`, id)')
    expect(ids.has('ts')).toBe(true)
    expect(ids.has('x')).toBe(true)
    expect(ids.has('id')).toBe(true)
  })
})

describe('buildMonolithicInsertSelectSql', () => {
  it('produces INSERT SELECT FINAL with sign=-1', () => {
    const sql = buildMonolithicInsertSelectSql({
      table: '"db"."t"',
      columns: ['id', 'ts', 'sign'],
      scopeWhere: 'id = {id:UInt64}',
    })
    expect(sql).toContain('INSERT INTO "db"."t" (id, ts, sign)')
    expect(sql).toContain('SELECT id, ts, -1 AS sign')
    expect(sql).toContain('FROM "db"."t" FINAL')
    expect(sql).toContain('WHERE (id = {id:UInt64})')
  })

  it('excludes sign from the projected/inserted column list exactly once', () => {
    const sql = buildMonolithicInsertSelectSql({
      table: 't',
      columns: ['a', 'sign', 'b'],
      scopeWhere: '1',
    })
    expect(sql).toContain('(a, b, sign)')
    expect(sql).toContain('SELECT a, b, -1 AS sign')
  })

  it('throws when no columns are provided', () => {
    expect(() => buildMonolithicInsertSelectSql({ table: 't', columns: [], scopeWhere: '1' })).toThrow(
      /no insertable columns/,
    )
  })
})

describe('resolveTargetTable', () => {
  it('resolves unqualified table against defaultDb', () => {
    expect(resolveTargetTable('t', 'mydb')).toEqual({
      db: 'mydb',
      unqualifiedTable: 't',
      qualifiedTable: '"mydb"."t"',
    })
  })

  it('splits db.tbl form', () => {
    expect(resolveTargetTable('foo.bar', 'mydb')).toEqual({
      db: 'foo',
      unqualifiedTable: 'bar',
      qualifiedTable: '"foo"."bar"',
    })
  })
})

describe('assertScopeIsolation', () => {
  it('allows a single target with empty scopeWhere', () => {
    const targets: RollbackTarget[] = [{ table: 't', scopeWhere: '' }]
    expect(() => assertScopeIsolation(targets)).not.toThrow()
  })

  it('allows multiple targets on the same table with non-empty scopes', () => {
    const targets: RollbackTarget[] = [
      { table: 't', scopeWhere: "writer = 'a'" },
      { table: 't', scopeWhere: "writer = 'b'" },
    ]
    expect(() => assertScopeIsolation(targets)).not.toThrow()
  })

  it('throws when multiple targets share a table and any scope is empty', () => {
    const targets: RollbackTarget[] = [
      { table: 't', scopeWhere: '' },
      { table: 't', scopeWhere: "writer = 'b'" },
    ]
    expect(() => assertScopeIsolation(targets)).toThrow(/cross-writer tombstoning/)
  })
})

describe('buildProbeSql', () => {
  it('uses no FINAL and parameterizes column identifier + safeCursor', () => {
    const sql = buildProbeSql({ table: '"db"."t"', scopeWhere: "writer = 'x'" })
    expect(sql).not.toMatch(/FINAL/)
    expect(sql).toContain('SELECT 1')
    expect(sql).toContain('FROM "db"."t"')
    expect(sql).toContain("WHERE (writer = 'x')")
    expect(sql).toContain('{cursorColumn:Identifier}')
    expect(sql).toContain('{safeCursor:UInt64}')
    expect(sql).toContain('LIMIT 1')
  })
})

describe('probeHasWorkToDo', () => {
  function makeStore(rows: unknown[]) {
    const query = vi.fn(async () => ({
      json: async () => rows,
    }))
    return { store: { query } as unknown as ClickhouseStore, query }
  }

  it('returns false when the probe row set is empty', async () => {
    const { store, query } = makeStore([])
    const result = await probeHasWorkToDo({
      store,
      table: '"db"."t"',
      scopeWhere: '1',
      cursorColumn: 'block_number',
      safeCursor: { number: 42 },
    })
    expect(result).toBe(false)
    const call = (query.mock.calls as any[])[0]![0] as { query_params: Record<string, unknown> }
    expect(call.query_params).toEqual({ cursorColumn: 'block_number', safeCursor: 42 })
  })

  it('returns true when the probe returns any row', async () => {
    const { store } = makeStore([{ '1': 1 }])
    const result = await probeHasWorkToDo({
      store,
      table: '"db"."t"',
      scopeWhere: '1',
      cursorColumn: 'block_number',
      safeCursor: { number: 42 },
    })
    expect(result).toBe(true)
  })

  it('merges user queryParams without clobbering probe-reserved names', async () => {
    const { store, query } = makeStore([])
    await probeHasWorkToDo({
      store,
      table: 't',
      scopeWhere: 'id = {id:UInt64}',
      cursorColumn: 'bn',
      safeCursor: { number: 99 },
      queryParams: { id: 7 },
    })
    const call = (query.mock.calls as any[])[0]![0] as { query_params: Record<string, unknown> }
    expect(call.query_params).toEqual({ id: 7, cursorColumn: 'bn', safeCursor: 99 })
  })
})

describe('dispatchRollback', () => {
  function makeStore(probeRows: unknown[] = []) {
    const query = vi.fn(async () => ({ json: async () => probeRows }))
    const command = vi.fn(async () => undefined)
    return { store: { query, command } as unknown as ClickhouseStore, query, command }
  }
  function makeIntrospector(columns: string[]) {
    return {
      columnsFor: vi.fn(async () => columns),
      invalidate: vi.fn(),
      clear: vi.fn(),
    } as unknown as ColumnIntrospector
  }

  it('short-circuits when cursorColumn+safeCursor are present and probe is empty', async () => {
    const { store, command } = makeStore([])
    const introspector = makeIntrospector(['id', 'sign'])

    const result = await dispatchRollback({
      store,
      introspector,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'block_number',
      safeCursor: { number: 100 },
    })

    expect(result).toEqual({ kind: 'short_circuit', table: '"db"."t"' })
    expect(command).not.toHaveBeenCalled()
  })

  it('runs monolithic when probe returns rows', async () => {
    const { store, command } = makeStore([{ '1': 1 }])
    const introspector = makeIntrospector(['id', 'sign'])

    const result = await dispatchRollback({
      store,
      introspector,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'block_number',
      safeCursor: { number: 100 },
    })

    expect(result).toMatchObject({ kind: 'monolithic', table: '"db"."t"' })
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('skips probe and runs monolithic when cursorColumn is absent', async () => {
    const { store, query, command } = makeStore([])
    const introspector = makeIntrospector(['id', 'sign'])

    const result = await dispatchRollback({
      store,
      introspector,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
    })

    expect(result).toMatchObject({ kind: 'monolithic' })
    expect(query).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('skips probe and runs monolithic when safeCursor is absent', async () => {
    const { store, query, command } = makeStore([])
    const introspector = makeIntrospector(['id', 'sign'])

    await dispatchRollback({
      store,
      introspector,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'block_number',
    })

    expect(query).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledTimes(1)
  })
})

describe('runMonolithicCleanup schema-drift retry', () => {
  function makeStore(commands: Array<{ resolve?: unknown; reject?: unknown }>): ClickhouseStore {
    let i = 0
    const command = vi.fn(async () => {
      const step = commands[i++]
      if (!step) throw new Error('unexpected extra command call')
      if (step.reject !== undefined) throw step.reject
      return step.resolve
    })
    return { command } as unknown as ClickhouseStore
  }

  function makeIntrospector(columns: string[]) {
    const invalidate = vi.fn()
    const columnsFor = vi.fn(async () => columns)
    return { invalidate, columnsFor, clear: vi.fn() } as unknown as ColumnIntrospector & {
      invalidate: ReturnType<typeof vi.fn>
      columnsFor: ReturnType<typeof vi.fn>
    }
  }

  it('retries once after a schema-drift error and invalidates the cache', async () => {
    const drift = Object.assign(new Error('mismatched'), { type: 'UNKNOWN_IDENTIFIER' })
    const store = makeStore([{ reject: drift }, { resolve: undefined }])
    const introspector = makeIntrospector(['id', 'sign'])

    const result = await runMonolithicCleanup({
      store,
      introspector,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
    })

    expect(result).toEqual({ kind: 'monolithic', table: '"db"."t"', rowsCanceled: null })
    expect((introspector as any).invalidate).toHaveBeenCalledTimes(1)
    expect((introspector as any).invalidate).toHaveBeenCalledWith('db', 't')
  })

  it('rethrows on a second consecutive schema-drift error', async () => {
    const drift = Object.assign(new Error('mismatched'), { type: 'THERE_IS_NO_COLUMN' })
    const store = makeStore([{ reject: drift }, { reject: drift }])
    const introspector = makeIntrospector(['id', 'sign'])

    await expect(
      runMonolithicCleanup({
        store,
        introspector,
        db: 'db',
        table: '"db"."t"',
        unqualifiedTable: 't',
        scopeWhere: '1',
      }),
    ).rejects.toBe(drift)
  })

  it('rethrows non-schema-drift errors immediately without retrying', async () => {
    const other = new Error('network exploded')
    const store = makeStore([{ reject: other }])
    const introspector = makeIntrospector(['id', 'sign'])

    await expect(
      runMonolithicCleanup({
        store,
        introspector,
        db: 'db',
        table: '"db"."t"',
        unqualifiedTable: 't',
        scopeWhere: '1',
      }),
    ).rejects.toBe(other)
    expect((introspector as any).invalidate).not.toHaveBeenCalled()
  })
})
