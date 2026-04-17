import { describe, expect, it, vi } from 'vitest'

import {
  CheckpointTableEnsurer,
  type ColumnIntrospector,
  RollbackSemaphore,
  type RollbackTarget,
  assertScopeIsolation,
  buildCheckpointTableDDL,
  buildChunkInsertSelectSql,
  buildMonolithicInsertSelectSql,
  buildProbeSql,
  computeChunkBounds,
  cursorColumnIsInSortKey,
  deriveMaxCursorBlockchainFork,
  deriveMaxCursorOffsetCheck,
  dispatchRollback,
  extractIdentifiers,
  getRollbackSemaphore,
  jitteredBackoff,
  probeHasWorkToDo,
  resolveRollbackSettings,
  resolveTargetTable,
  runChunkedRollback,
  runMonolithicCleanup,
  sanitizeIdentifier,
  snapshotOrphanPattern,
  snapshotTableName,
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

// ────────────────────────────────────────────────────────────────────────────
// Phase 3 — chunked/resumable rollback
// ────────────────────────────────────────────────────────────────────────────

describe('computeChunkBounds', () => {
  it('returns zero chunks when range is empty', () => {
    expect(computeChunkBounds({ safeCursor: 100, maxCursor: 100, chunkSize: 10 })).toEqual({
      totalChunks: 0,
      chunks: [],
    })
    expect(computeChunkBounds({ safeCursor: 100, maxCursor: 90, chunkSize: 10 })).toEqual({
      totalChunks: 0,
      chunks: [],
    })
  })

  it('tiles (safeCursor, maxCursor] with half-open chunks', () => {
    const r = computeChunkBounds({ safeCursor: 100, maxCursor: 250, chunkSize: 50 })
    expect(r.totalChunks).toBe(3)
    expect(r.chunks).toEqual([
      { chunkFrom: 100, chunkTo: 150 },
      { chunkFrom: 150, chunkTo: 200 },
      { chunkFrom: 200, chunkTo: 250 },
    ])
  })

  it('pins last chunkTo to maxCursor for non-divisible ranges', () => {
    const r = computeChunkBounds({ safeCursor: 0, maxCursor: 25, chunkSize: 10 })
    expect(r.totalChunks).toBe(3)
    expect(r.chunks[2]).toEqual({ chunkFrom: 20, chunkTo: 25 })
  })

  it('rejects non-positive chunkSize', () => {
    expect(() => computeChunkBounds({ safeCursor: 0, maxCursor: 10, chunkSize: 0 })).toThrow(/chunkSize/)
  })
})

describe('deriveMaxCursorBlockchainFork', () => {
  it('returns syncCurrent.number without running SQL', () => {
    expect(deriveMaxCursorBlockchainFork({ syncCurrent: { number: 9_999 } })).toBe(9_999)
  })
})

describe('deriveMaxCursorOffsetCheck', () => {
  it('returns coalesce(max(col), safeCursor) from the server', async () => {
    const query = vi.fn(async () => ({ json: async () => [{ m: 777 }] }))
    const store = { query } as unknown as ClickhouseStore
    const m = await deriveMaxCursorOffsetCheck({
      store,
      table: '"db"."t"',
      scopeWhere: '1',
      cursorColumn: 'bn',
      safeCursor: { number: 500 },
    })
    expect(m).toBe(777)
    const call = (query.mock.calls as any[])[0]![0]
    expect(call.query_params).toMatchObject({ cursorColumn: 'bn', safeCursor: 500 })
    expect(call.query).not.toMatch(/FINAL/)
  })

  it('falls back to safeCursor when the server returns no row', async () => {
    const query = vi.fn(async () => ({ json: async () => [] }))
    const store = { query } as unknown as ClickhouseStore
    const m = await deriveMaxCursorOffsetCheck({
      store,
      table: 't',
      scopeWhere: '1',
      cursorColumn: 'bn',
      safeCursor: { number: 42 },
    })
    expect(m).toBe(42)
  })
})

describe('snapshot table naming (5b)', () => {
  it('sanitizes punctuation and mixed case to [a-z0-9_]', () => {
    expect(sanitizeIdentifier('Foo-Bar.Baz Qux')).toBe('foo_bar_baz_qux')
    expect(sanitizeIdentifier('abc123')).toBe('abc123')
  })

  it('builds deterministic snapshot table names', () => {
    expect(snapshotTableName({ streamSafe: 's1', tableSafe: 't1', startedAtUnix: 1_234_567_890 })).toBe(
      '_sqd_chunk_snapshot_s1_t1_1234567890',
    )
  })

  it('builds an anchored regex pattern that avoids LIKE _ wildcard collisions', () => {
    const pattern = snapshotOrphanPattern('s1', 't1')
    const rx = new RegExp(pattern)
    expect(rx.test('_sqd_chunk_snapshot_s1_t1_1234567890')).toBe(true)
    expect(rx.test('_sqd_chunk_snapshot_s1_t1_other')).toBe(false)
    expect(rx.test('_sqd_chunk_snapshot_s1_t1_')).toBe(false)
    expect(rx.test('_sqd_chunk_snapshot_s1other_t1_1234567890')).toBe(false)
  })
})

describe('buildChunkInsertSelectSql', () => {
  it('produces a half-open bounded INSERT SELECT FINAL', () => {
    const sql = buildChunkInsertSelectSql({
      table: '"db"."t"',
      columns: ['id', 'ts', 'sign'],
      scopeWhere: '1',
    })
    expect(sql).toContain('INSERT INTO "db"."t" (id, ts, sign)')
    expect(sql).toContain('SELECT id, ts, -1 AS sign')
    expect(sql).toContain('FROM "db"."t" FINAL')
    expect(sql).toContain('WHERE (1)')
    expect(sql).toContain('{cursorColumn:Identifier} >  {chunkFrom:UInt64}')
    expect(sql).toContain('{cursorColumn:Identifier} <= {chunkTo:UInt64}')
  })
})

describe('buildCheckpointTableDDL', () => {
  it('declares all 7 non-sign columns and TTL + ORDER BY', () => {
    const ddl = buildCheckpointTableDDL('"db"."_sqd_rollback_checkpoint"')
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "db"."_sqd_rollback_checkpoint"')
    expect(ddl).toContain('stream              String')
    expect(ddl).toContain('table_name          String')
    expect(ddl).toContain('started_at          DateTime')
    expect(ddl).toContain('safe_cursor         UInt64')
    expect(ddl).toContain('max_cursor          UInt64')
    expect(ddl).toContain('chunk_size          UInt64')
    expect(ddl).toContain('last_completed_chunk Int64')
    expect(ddl).toContain('ENGINE = CollapsingMergeTree(sign)')
    expect(ddl).toContain('ORDER BY (stream, table_name, started_at)')
    expect(ddl).toContain('TTL started_at + INTERVAL 7 DAY')
  })
})

describe('CheckpointTableEnsurer', () => {
  it('issues the DDL once per (db, table) key', async () => {
    const command = vi.fn(async () => undefined)
    const store = { command } as unknown as ClickhouseStore
    const ensurer = new CheckpointTableEnsurer()

    const q1 = await ensurer.ensure({ store, db: 'db', checkpointTable: '_sqd_rollback_checkpoint' })
    const q2 = await ensurer.ensure({ store, db: 'db', checkpointTable: '_sqd_rollback_checkpoint' })
    expect(q1).toBe('"db"."_sqd_rollback_checkpoint"')
    expect(q1).toBe(q2)
    expect(command).toHaveBeenCalledTimes(1)

    await ensurer.ensure({ store, db: 'other', checkpointTable: '_sqd_rollback_checkpoint' })
    expect(command).toHaveBeenCalledTimes(2)
  })
})

describe('runChunkedRollback', () => {
  type MockStore = {
    command: ReturnType<typeof vi.fn>
    query: ReturnType<typeof vi.fn>
  }

  function buildStore(opts: { checkpointRows: unknown[]; maxCursor?: number }): {
    store: ClickhouseStore
    mock: MockStore
  } {
    const command = vi.fn(async () => undefined)
    // order of query() calls: (1) read checkpoint, (2) maybe deriveMaxCursor
    const results: Array<{ json: () => Promise<unknown[]> }> = [{ json: async () => opts.checkpointRows }]
    if (opts.maxCursor !== undefined) {
      results.push({ json: async () => [{ m: opts.maxCursor }] })
    }
    let i = 0
    const query = vi.fn(async () => {
      const r = results[i++]
      if (!r) throw new Error('unexpected extra query call')
      return r
    })
    return { store: { command, query } as unknown as ClickhouseStore, mock: { command, query } }
  }

  function introspector(columns: string[]) {
    return {
      columnsFor: vi.fn(async () => columns),
      invalidate: vi.fn(),
      clear: vi.fn(),
    } as unknown as ColumnIntrospector
  }

  it('fresh rollback: derives max_cursor, writes init, runs N chunks + advances, retires', async () => {
    const { store, mock } = buildStore({ checkpointRows: [], maxCursor: 220 })
    const ensurer = new CheckpointTableEnsurer()
    const result = await runChunkedRollback({
      store,
      introspector: introspector(['id', 'sign']),
      ensurer,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'bn',
      stream: 's1',
      chunkSize: 100,
      checkpointTable: '_sqd_rollback_checkpoint',
      safeCursor: { number: 100 },
      reason: 'offset_check',
    })
    // commands: ensure-DDL + init-write + 2 chunk INSERTs + 2 advances + retire = 7
    expect(mock.command).toHaveBeenCalledTimes(7)
    expect(result).toMatchObject({
      kind: 'chunked',
      table: '"db"."t"',
      chunksPlanned: 2,
      chunksCompleted: 2,
      resumed: false,
    })
  })

  it('blockchain_fork: uses syncCurrent.number as max_cursor, never runs derive SELECT', async () => {
    const { store, mock } = buildStore({ checkpointRows: [] }) // no maxCursor → query will fail if called
    const ensurer = new CheckpointTableEnsurer()
    const result = await runChunkedRollback({
      store,
      introspector: introspector(['id', 'sign']),
      ensurer,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'bn',
      stream: 's1',
      chunkSize: 50,
      checkpointTable: '_sqd_rollback_checkpoint',
      safeCursor: { number: 0 },
      reason: 'blockchain_fork',
      syncCurrent: { number: 120 },
    })
    expect(result).toMatchObject({ kind: 'chunked', chunksPlanned: 3, chunksCompleted: 3, resumed: false })
    // query was used only for readCheckpoint (one call)
    expect(mock.query).toHaveBeenCalledTimes(1)
  })

  it('throws if blockchain_fork and syncCurrent is absent', async () => {
    const { store } = buildStore({ checkpointRows: [] })
    await expect(
      runChunkedRollback({
        store,
        introspector: introspector(['id', 'sign']),
        ensurer: new CheckpointTableEnsurer(),
        db: 'db',
        table: '"db"."t"',
        unqualifiedTable: 't',
        scopeWhere: '1',
        cursorColumn: 'bn',
        stream: 's1',
        chunkSize: 50,
        checkpointTable: '_sqd_rollback_checkpoint',
        safeCursor: { number: 0 },
        reason: 'blockchain_fork',
      }),
    ).rejects.toThrow(/syncCurrent/)
  })

  it('resume: skips init write and picks up at last_completed_chunk + 1', async () => {
    const { store, mock } = buildStore({
      checkpointRows: [
        {
          stream: 's1',
          table_name: '"db"."t"',
          safe_cursor: 100,
          max_cursor: 220,
          chunk_size: 100,
          last_completed_chunk: 0, // completed chunk 0; should run chunk 1 next
          started_at_unix: 1_700_000_000,
        },
      ],
    })
    const ensurer = new CheckpointTableEnsurer()
    const result = await runChunkedRollback({
      store,
      introspector: introspector(['id', 'sign']),
      ensurer,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'bn',
      stream: 's1',
      chunkSize: 100, // ignored — resume pulls chunk_size from checkpoint
      checkpointTable: '_sqd_rollback_checkpoint',
      safeCursor: { number: 100 },
      reason: 'offset_check',
    })
    // commands: ensure-DDL + 1 chunk INSERT + 1 advance + retire = 4 (no init-write)
    expect(mock.command).toHaveBeenCalledTimes(4)
    expect(result).toMatchObject({ chunksPlanned: 2, chunksCompleted: 1, resumed: true })
  })

  it('PC-3 shortcut: resume with last_completed_chunk+1 == totalChunks runs no chunks', async () => {
    const { store, mock } = buildStore({
      checkpointRows: [
        {
          stream: 's1',
          table_name: '"db"."t"',
          safe_cursor: 100,
          max_cursor: 220,
          chunk_size: 100,
          last_completed_chunk: 1, // all 2 chunks done; only retire remains
          started_at_unix: 1_700_000_000,
        },
      ],
    })
    const ensurer = new CheckpointTableEnsurer()
    const result = await runChunkedRollback({
      store,
      introspector: introspector(['id', 'sign']),
      ensurer,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'bn',
      stream: 's1',
      chunkSize: 100,
      checkpointTable: '_sqd_rollback_checkpoint',
      safeCursor: { number: 100 },
      reason: 'offset_check',
    })
    // commands: ensure-DDL + retire = 2 (no chunk, no advance)
    expect(mock.command).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ chunksPlanned: 2, chunksCompleted: 0, resumed: true })
  })
})

describe('dispatchRollback (chunked)', () => {
  it('runs chunked path when probe returns rows and chunked config is supplied', async () => {
    const probe = { json: async () => [{ '1': 1 }] } // probe hit
    const max = { json: async () => [{ m: 200 }] }
    const readCp = { json: async () => [] }
    const results = [probe, readCp, max]
    let i = 0
    const query = vi.fn(async () => results[i++]!)
    const command = vi.fn(async () => undefined)
    const store = { query, command } as unknown as ClickhouseStore
    const introspectorMock = {
      columnsFor: vi.fn(async () => ['id', 'sign']),
      invalidate: vi.fn(),
      clear: vi.fn(),
    } as unknown as ColumnIntrospector

    const result = await dispatchRollback({
      store,
      introspector: introspectorMock,
      db: 'db',
      table: '"db"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'bn',
      safeCursor: { number: 100 },
      chunked: {
        ensurer: new CheckpointTableEnsurer(),
        stream: 's1',
        chunkSize: 50,
        checkpointTable: '_sqd_rollback_checkpoint',
        reason: 'offset_check',
      },
    })
    expect(result.kind).toBe('chunked')
    expect(command).toHaveBeenCalled()
  })
})

describe('jitteredBackoff', () => {
  it('computes base * (0.5 + random * jitter * 2) with injected rng', () => {
    expect(jitteredBackoff(100, 0.5, () => 0)).toBe(50)
    expect(jitteredBackoff(100, 0.5, () => 1)).toBe(150)
    expect(jitteredBackoff(100, 0.5, () => 0.5)).toBe(100)
  })

  it('respects jitter=0 (no spread)', () => {
    expect(jitteredBackoff(200, 0, () => 0)).toBe(100)
    expect(jitteredBackoff(200, 0, () => 1)).toBe(100)
  })

  it('defaults to Math.random and falls inside [0.5×base, 1.5×base] for default jitter', () => {
    for (let i = 0; i < 100; i++) {
      const d = jitteredBackoff(1000, 0.5)
      expect(d).toBeGreaterThanOrEqual(500)
      expect(d).toBeLessThanOrEqual(1500)
    }
  })
})

describe('RollbackSemaphore', () => {
  it('rejects concurrency < 1', () => {
    expect(() => new RollbackSemaphore({ concurrency: 0, baseMs: 0, jitter: 0 })).toThrow()
  })

  it('caps in-flight at concurrency', async () => {
    const sem = new RollbackSemaphore({ concurrency: 2, baseMs: 0, jitter: 0 })
    let maxInFlight = 0
    let active = 0

    const work = async () => {
      const release = await sem.acquire()
      active++
      maxInFlight = Math.max(maxInFlight, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      release()
    }

    await Promise.all(Array.from({ length: 10 }, () => work()))
    expect(maxInFlight).toBe(2)
    expect(sem.inFlight).toBe(0)
  })

  it('runs acquires serially when concurrency = 1', async () => {
    const sem = new RollbackSemaphore({ concurrency: 1, baseMs: 0, jitter: 0 })
    const order: number[] = []

    const work = async (id: number) => {
      const release = await sem.acquire()
      order.push(id)
      await new Promise((r) => setTimeout(r, 2))
      release()
    }

    await Promise.all([work(1), work(2), work(3)])
    expect(order).toEqual([1, 2, 3])
    expect(sem.inFlight).toBe(0)
  })

  it('applies jittered delay when waking waiters', async () => {
    const sem = new RollbackSemaphore({ concurrency: 1, baseMs: 60, jitter: 0, rng: () => 0.5 })

    const release1 = await sem.acquire()
    const startedAt = Date.now()
    let resumedAt = 0
    const p = sem.acquire().then((r) => {
      resumedAt = Date.now()
      r()
    })
    release1()
    await p
    expect(resumedAt - startedAt).toBeGreaterThanOrEqual(25)
  })
})

describe('getRollbackSemaphore', () => {
  it('returns the same instance for the same (client, db) tuple', () => {
    const client = {}
    const a = getRollbackSemaphore({ client, db: 'default', concurrency: 2, baseMs: 10, jitter: 0 })
    const b = getRollbackSemaphore({ client, db: 'default', concurrency: 2, baseMs: 10, jitter: 0 })
    expect(a).toBe(b)
  })

  it('partitions by db', () => {
    const client = {}
    const a = getRollbackSemaphore({ client, db: 'db1', concurrency: 2, baseMs: 10, jitter: 0 })
    const b = getRollbackSemaphore({ client, db: 'db2', concurrency: 2, baseMs: 10, jitter: 0 })
    expect(a).not.toBe(b)
  })

  it('partitions by client', () => {
    const a = getRollbackSemaphore({ client: {}, db: 'default', concurrency: 2, baseMs: 10, jitter: 0 })
    const b = getRollbackSemaphore({ client: {}, db: 'default', concurrency: 2, baseMs: 10, jitter: 0 })
    expect(a).not.toBe(b)
  })
})

describe('dispatchRollback log events (Phase 5)', () => {
  const makeLogger = () => {
    const events: Array<{ payload: any; msg: string }> = []
    const fn = (payload: any, msg: string) => events.push({ payload, msg })
    return {
      logger: { info: fn, debug: fn, warn: fn, error: fn } as any,
      events,
    }
  }

  it('emits start with probeKind=none + end (monolithic) when no cursorColumn', async () => {
    const { logger, events } = makeLogger()
    const command = vi.fn().mockResolvedValue(undefined)
    const query = vi.fn()
    const store = { command, query } as unknown as ClickhouseStore
    const introspector = {
      columnsFor: vi.fn().mockResolvedValue(['id', 'value', 'sign']),
      invalidate: vi.fn(),
    } as unknown as ColumnIntrospector

    await dispatchRollback({
      store,
      introspector,
      db: 'default',
      table: '"default"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      logger,
      reason: 'offset_check',
      stream: 'pipe1',
    })

    const starts = events.filter((e) => e.payload.event === 'rollback.start')
    const ends = events.filter((e) => e.payload.event === 'rollback.end')
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(starts[0]!.payload).toMatchObject({
      event: 'rollback.start',
      stream: 'pipe1',
      table: '"default"."t"',
      reason: 'offset_check',
      cursorColumn: null,
      safeCursor: null,
      probeKind: 'none',
    })
    expect(ends[0]!.payload).toMatchObject({
      event: 'rollback.end',
      kind: 'monolithic',
      stream: 'pipe1',
      table: '"default"."t"',
    })
    expect(typeof ends[0]!.payload.totalDurationMs).toBe('number')
  })

  it('emits start + short_circuit end when probe finds no work', async () => {
    const { logger, events } = makeLogger()
    const query = vi.fn().mockResolvedValue({
      json: async () => [],
    })
    const command = vi.fn()
    const store = { command, query } as unknown as ClickhouseStore
    const introspector = {
      columnsFor: vi.fn(),
      invalidate: vi.fn(),
    } as unknown as ColumnIntrospector

    await dispatchRollback({
      store,
      introspector,
      db: 'default',
      table: '"default"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'block_number',
      safeCursor: { number: 100, hash: 'h', timestamp: 0 },
      logger,
      reason: 'offset_check',
      stream: 'pipe1',
    })

    const starts = events.filter((e) => e.payload.event === 'rollback.start')
    const ends = events.filter((e) => e.payload.event === 'rollback.end')
    expect(starts[0]!.payload).toMatchObject({
      probeKind: 'exists',
      cursorColumn: 'block_number',
      safeCursor: 100,
    })
    expect(ends[0]!.payload).toMatchObject({
      event: 'rollback.end',
      kind: 'short_circuit',
    })
    expect(command).not.toHaveBeenCalled()
  })

  it('end-event keys exactly match the discriminated union (no stray fields)', async () => {
    const { logger, events } = makeLogger()
    const query = vi.fn().mockResolvedValue({ json: async () => [] })
    const store = { command: vi.fn(), query } as unknown as ClickhouseStore
    const introspector = {
      columnsFor: vi.fn(),
      invalidate: vi.fn(),
    } as unknown as ColumnIntrospector

    await dispatchRollback({
      store,
      introspector,
      db: 'default',
      table: '"default"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'block_number',
      safeCursor: { number: 100, hash: 'h', timestamp: 0 },
      logger,
    })

    const end = events.find((e) => e.payload.event === 'rollback.end')!.payload
    expect(Object.keys(end).sort()).toEqual(['event', 'kind', 'stream', 'table', 'totalDurationMs'].sort())
  })
})

describe('runChunkedRollback log events (Phase 5)', () => {
  it('emits a rollback.chunk event per completed chunk with chunkFrom/chunkTo/durationMs', async () => {
    const events: Array<{ payload: any; msg: string }> = []
    const fn = (payload: any, msg: string) => events.push({ payload, msg })
    const logger = { info: fn, debug: fn, warn: fn, error: fn } as any

    const command = vi.fn().mockResolvedValue(undefined)
    const query = vi
      .fn()
      // readCheckpoint → no existing
      .mockResolvedValueOnce({ json: async () => [] })
      // deriveMaxCursorOffsetCheck → max=200
      .mockResolvedValueOnce({ json: async () => [{ m: 200 }] })
    const store = { command, query } as unknown as ClickhouseStore
    const introspector = {
      columnsFor: vi.fn().mockResolvedValue(['block_number', 'value', 'sign']),
      invalidate: vi.fn(),
    } as unknown as ColumnIntrospector
    const ensurer = new CheckpointTableEnsurer()

    const result = await runChunkedRollback({
      store,
      introspector,
      ensurer,
      db: 'default',
      table: '"default"."t"',
      unqualifiedTable: 't',
      scopeWhere: '1',
      cursorColumn: 'block_number',
      stream: 's1',
      chunkSize: 50,
      checkpointTable: '_sqd_rollback_checkpoint',
      safeCursor: { number: 100, hash: 'h', timestamp: 0 },
      reason: 'offset_check',
      logger,
    })

    expect(result.kind).toBe('chunked')
    const chunkEvents = events.filter((e) => e.payload.event === 'rollback.chunk')
    expect(chunkEvents).toHaveLength(2)
    expect(chunkEvents[0]!.payload).toMatchObject({
      event: 'rollback.chunk',
      stream: 's1',
      table: '"default"."t"',
      chunkIndex: 0,
      chunkFrom: 100,
      chunkTo: 150,
    })
    expect(chunkEvents[1]!.payload).toMatchObject({
      chunkIndex: 1,
      chunkFrom: 150,
      chunkTo: 200,
    })
    for (const e of chunkEvents) {
      expect(typeof e.payload.durationMs).toBe('number')
    }
  })
})
