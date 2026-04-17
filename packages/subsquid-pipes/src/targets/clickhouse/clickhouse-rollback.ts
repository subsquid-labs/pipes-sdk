import type { BlockCursor, Logger } from '~/core/index.js'

import type { ClickhouseStore } from './clickhouse-store.js'

export type RollbackReason = 'offset_check' | 'blockchain_fork'

/**
 * A user table the SDK should roll back on `offset_check` and `blockchain_fork`.
 * Pinned config shape per rev-2 B1 in the implementation plan.
 */
export type RollbackTarget = {
  /** Fully-qualified `<db>.<tbl>` or unqualified `<tbl>` (resolved against the client's connection database). */
  table: string
  /** Parameterized SQL fragment inlined verbatim into every probe/chunk/monolithic WHERE. */
  scopeWhere: string
  /** Query parameters referenced by `scopeWhere`. */
  params?: Record<string, unknown>
  /** Optional sort-key column enabling the EXISTS short-circuit and chunked rollback. */
  cursorColumn?: string
}

export type RollbackSettings = {
  targets?: RollbackTarget[]
  concurrency?: number
  chunkSize?: number
  retryBackoff?: { baseMs?: number; jitter?: number }
  checkpointTable?: string
}

/** Discriminated result of a managed rollback invocation. */
export type RollbackResult =
  | { kind: 'short_circuit'; table: string }
  | { kind: 'monolithic'; table: string; rowsCanceled: null }
  | {
      kind: 'chunked'
      table: string
      chunksPlanned: number
      chunksCompleted: number
      resumed: boolean
    }

export const DEFAULT_ROLLBACK_CONCURRENCY = 2
export const DEFAULT_ROLLBACK_CHUNK_SIZE = 500_000
export const DEFAULT_ROLLBACK_BACKOFF_BASE_MS = 250
export const DEFAULT_ROLLBACK_BACKOFF_JITTER = 0.5
export const DEFAULT_ROLLBACK_CHECKPOINT_TABLE = '_sqd_rollback_checkpoint'

/** Resolved settings with defaults applied. */
export type ResolvedRollbackSettings = {
  targets: RollbackTarget[]
  concurrency: number
  chunkSize: number
  retryBackoff: { baseMs: number; jitter: number }
  checkpointTable: string
}

export function resolveRollbackSettings(s?: RollbackSettings): ResolvedRollbackSettings {
  return {
    targets: s?.targets ?? [],
    concurrency: s?.concurrency ?? DEFAULT_ROLLBACK_CONCURRENCY,
    chunkSize: s?.chunkSize ?? DEFAULT_ROLLBACK_CHUNK_SIZE,
    retryBackoff: {
      baseMs: s?.retryBackoff?.baseMs ?? DEFAULT_ROLLBACK_BACKOFF_BASE_MS,
      jitter: s?.retryBackoff?.jitter ?? DEFAULT_ROLLBACK_BACKOFF_JITTER,
    },
    checkpointTable: s?.checkpointTable ?? DEFAULT_ROLLBACK_CHECKPOINT_TABLE,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Sort-key parser (NB5)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Split the CH `sorting_key` DDL form into top-level entries, respecting
 * parenthesis depth and backtick-quoted identifiers.
 */
export function splitSortKeyEntries(sortingKey: string): string[] {
  let s = sortingKey.trim()
  // Strip a single balanced outer paren pair if present.
  if (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0
    let balancedAtTail = true
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0 && i < s.length - 1) {
          balancedAtTail = false
          break
        }
      }
    }
    if (balancedAtTail && depth === 0) s = s.slice(1, -1).trim()
  }

  const entries: string[] = []
  let depth = 0
  let inBacktick = false
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '`') {
      inBacktick = !inBacktick
      buf += ch
      continue
    }
    if (!inBacktick) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) {
        entries.push(buf.trim())
        buf = ''
        continue
      }
    }
    buf += ch
  }
  if (buf.trim().length > 0) entries.push(buf.trim())
  return entries
}

/** Extract the set of bare identifiers referenced by a single sort-key entry. */
export function extractIdentifiers(entry: string): Set<string> {
  const ids = new Set<string>()
  let i = 0
  while (i < entry.length) {
    const ch = entry[i]
    if (ch === '`') {
      let j = i + 1
      while (j < entry.length && entry[j] !== '`') j++
      if (j > i + 1) ids.add(entry.slice(i + 1, j))
      i = j + 1
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < entry.length && /[A-Za-z0-9_]/.test(entry[j]!)) j++
      const token = entry.slice(i, j)
      // Skip token if immediately followed by `(` — it's a function name.
      let k = j
      while (k < entry.length && /\s/.test(entry[k]!)) k++
      const isFunctionName = entry[k] === '('
      if (!isFunctionName) ids.add(token)
      i = j
      continue
    }
    i++
  }
  return ids
}

/** Returns the set of identifiers referenced anywhere in the ORDER BY. */
export function sortKeyIdentifiers(sortingKey: string): Set<string> {
  const all = new Set<string>()
  for (const entry of splitSortKeyEntries(sortingKey)) {
    for (const id of extractIdentifiers(entry)) all.add(id)
  }
  return all
}

/** True if `cursorColumn` appears anywhere in the ORDER BY expression. */
export function cursorColumnIsInSortKey(sortingKey: string, cursorColumn: string): boolean {
  return sortKeyIdentifiers(sortingKey).has(cursorColumn)
}

// ────────────────────────────────────────────────────────────────────────────
// Column introspection (M-1 + DDL-churn cache key)
// ────────────────────────────────────────────────────────────────────────────

type ColumnCacheEntry = { schemaVersion: string; columns: string[] }

export class ColumnIntrospector {
  #cache = new Map<string, ColumnCacheEntry>()

  constructor(private store: ClickhouseStore) {}

  /** Resets the cache entry for a single `(db, table)` key. */
  invalidate(db: string, table: string) {
    this.#cache.delete(`${db}.${table}`)
  }

  /** Clears the entire cache. */
  clear() {
    this.#cache.clear()
  }

  /**
   * Returns the list of insertable (non-ALIAS, non-MATERIALIZED) columns for a
   * table, cached by `(db, table, metadata_modification_time)`.
   */
  async columnsFor(db: string, table: string): Promise<string[]> {
    const cacheKey = `${db}.${table}`
    const currentVersion = await this.#schemaVersion(db, table)
    const hit = this.#cache.get(cacheKey)
    if (hit && hit.schemaVersion === currentVersion) return hit.columns
    const columns = await this.#fetchColumns(db, table)
    this.#cache.set(cacheKey, { schemaVersion: currentVersion, columns })
    return columns
  }

  async #schemaVersion(db: string, table: string): Promise<string> {
    const res = await this.store.query({
      query: `
        SELECT toUnixTimestamp(metadata_modification_time) AS v
        FROM system.tables
        WHERE database = {db:String} AND name = {tbl:String}
      `,
      format: 'JSONEachRow',
      query_params: { db, tbl: table },
    })
    const rows = await res.json<{ v: string | number }>()
    if (rows.length === 0) {
      throw new Error(`clickhouseTarget: table ${db}.${table} not found in system.tables`)
    }
    return String(rows[0]!.v)
  }

  async #fetchColumns(db: string, table: string): Promise<string[]> {
    const res = await this.store.query({
      query: `
        SELECT name
        FROM system.columns
        WHERE database = {db:String} AND table = {tbl:String}
          AND default_kind NOT IN ('ALIAS', 'MATERIALIZED')
        ORDER BY position
      `,
      format: 'JSONEachRow',
      query_params: { db, tbl: table },
    })
    const rows = await res.json<{ name: string }>()
    return rows.map((r) => r.name)
  }
}

// ────────────────────────────────────────────────────────────────────────────
// EXISTS probe (Phase 2 Step 1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the single-row probe SQL:
 *   `SELECT 1 FROM <table> WHERE (<scopeWhere>) AND {cursorColumn:Identifier} > {safeCursor:UInt64} LIMIT 1`
 *
 * No `FINAL`, no `SETTINGS max_rows_to_read` — relies on sort-key pruning.
 * Unmerged tombstones may cause the probe to return `true` even when the
 * logical state is empty; the monolithic INSERT SELECT FINAL that runs next
 * is idempotent on already-cancelled keys, so this is not a soundness defect.
 */
export function buildProbeSql(params: { table: string; scopeWhere: string }): string {
  const { table, scopeWhere } = params
  return `SELECT 1
FROM ${table}
WHERE (${scopeWhere})
  AND {cursorColumn:Identifier} > {safeCursor:UInt64}
LIMIT 1`
}

/**
 * Runs the EXISTS probe. Returns `true` when at least one physical row past
 * `safeCursor` matches the scope.
 */
export async function probeHasWorkToDo(params: {
  store: ClickhouseStore
  table: string
  scopeWhere: string
  cursorColumn: string
  safeCursor: BlockCursor
  queryParams?: Record<string, unknown>
}): Promise<boolean> {
  const { store, table, scopeWhere, cursorColumn, safeCursor, queryParams } = params
  const sql = buildProbeSql({ table, scopeWhere })
  const res = await store.query({
    query: sql,
    format: 'JSONEachRow',
    query_params: {
      ...(queryParams ?? {}),
      cursorColumn,
      safeCursor: safeCursor.number,
    },
  })
  const rows = await res.json<unknown>()
  return rows.length > 0
}

// ────────────────────────────────────────────────────────────────────────────
// Monolithic cleanup (Phase 1 Step 3)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the monolithic `INSERT INTO t (cols, sign) SELECT cols, -1 FROM t FINAL WHERE <scope>`
 * statement. `scopeWhere` is inlined verbatim; identifier quoting in the table
 * name and column list is the caller's responsibility to produce safe input.
 */
export function buildMonolithicInsertSelectSql(params: {
  table: string
  columns: string[]
  scopeWhere: string
}): string {
  const { table, columns, scopeWhere } = params
  if (columns.length === 0) {
    throw new Error(`clickhouseTarget: no insertable columns resolved for table ${table}`)
  }
  const nonSignCols = columns.filter((c) => c !== 'sign')
  const colList = nonSignCols.join(', ')
  return `INSERT INTO ${table} (${colList}, sign)
SELECT ${colList}, -1 AS sign
FROM ${table} FINAL
WHERE (${scopeWhere})`
}

/** Error-class set used by Phase 1 Step 4 cache-invalidation retry. */
export const SCHEMA_DRIFT_ERROR_TYPES = new Set([
  'UNKNOWN_IDENTIFIER',
  'THERE_IS_NO_COLUMN',
  'NOT_FOUND_COLUMN_IN_BLOCK',
])

function isSchemaDriftError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'type' in err) {
    const t = (err as { type?: unknown }).type
    if (typeof t === 'string' && SCHEMA_DRIFT_ERROR_TYPES.has(t)) return true
  }
  if (err instanceof Error) {
    for (const t of SCHEMA_DRIFT_ERROR_TYPES) if (err.message.includes(t)) return true
  }
  return false
}

/**
 * Run the monolithic server-side INSERT SELECT with error-code-driven cache
 * invalidation (Phase 1 Step 4). One retry on schema-drift errors; a second
 * consecutive schema-drift is rethrown.
 */
export async function runMonolithicCleanup(params: {
  store: ClickhouseStore
  introspector: ColumnIntrospector
  db: string
  table: string
  unqualifiedTable: string
  scopeWhere: string
  queryParams?: Record<string, unknown>
}): Promise<RollbackResult> {
  const { store, introspector, db, table, unqualifiedTable, scopeWhere, queryParams } = params

  const attempt = async () => {
    const columns = await introspector.columnsFor(db, unqualifiedTable)
    const sql = buildMonolithicInsertSelectSql({ table, columns, scopeWhere })
    await store.command({ query: sql, query_params: queryParams })
  }

  try {
    await attempt()
  } catch (err) {
    if (!isSchemaDriftError(err)) throw err
    introspector.invalidate(db, unqualifiedTable)
    await attempt()
  }

  return { kind: 'monolithic', table, rowsCanceled: null }
}

// ────────────────────────────────────────────────────────────────────────────
// Dispatch: probe → short-circuit | monolithic (Phase 2 Step 2)
// ────────────────────────────────────────────────────────────────────────────

/**
 * For a single target: if `cursorColumn` and `safeCursor` are both present,
 * run the EXISTS probe. Empty probe → `{ kind: 'short_circuit' }` and skip
 * the INSERT SELECT. Otherwise fall through to the monolithic path.
 *
 * Phase 3 will replace the monolithic fallthrough with the chunked/resumable
 * path when both inputs are present.
 */
export async function dispatchRollback(params: {
  store: ClickhouseStore
  introspector: ColumnIntrospector
  db: string
  table: string
  unqualifiedTable: string
  scopeWhere: string
  cursorColumn?: string
  safeCursor?: BlockCursor
  queryParams?: Record<string, unknown>
  logger?: Logger
}): Promise<RollbackResult> {
  const {
    store,
    introspector,
    db,
    table,
    unqualifiedTable,
    scopeWhere,
    cursorColumn,
    safeCursor,
    queryParams,
    logger,
  } = params

  if (cursorColumn && safeCursor) {
    const hasWork = await probeHasWorkToDo({
      store,
      table,
      scopeWhere,
      cursorColumn,
      safeCursor,
      queryParams,
    })
    if (!hasWork) {
      logger?.debug?.(
        { event: 'rollback.short_circuit', table, safeCursor: safeCursor.number },
        'managed rollback short-circuited; probe found no rows past safeCursor',
      )
      return { kind: 'short_circuit', table }
    }
  }

  return runMonolithicCleanup({
    store,
    introspector,
    db,
    table,
    unqualifiedTable,
    scopeWhere,
    queryParams,
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Managed rollback (Phase 1 Step 6)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a `RollbackTarget.table` into `{db, unqualifiedTable, qualifiedTable}`
 * where `db` falls back to `defaultDb`.
 */
export function resolveTargetTable(
  targetTable: string,
  defaultDb: string,
): { db: string; unqualifiedTable: string; qualifiedTable: string } {
  if (targetTable.includes('.')) {
    const [db, ...rest] = targetTable.split('.')
    const unqualifiedTable = rest.join('.')
    return { db: db!, unqualifiedTable, qualifiedTable: `"${db}"."${unqualifiedTable}"` }
  }
  return {
    db: defaultDb,
    unqualifiedTable: targetTable,
    qualifiedTable: `"${defaultDb}"."${targetTable}"`,
  }
}

export type ManagedRollbackContext = {
  store: ClickhouseStore
  introspector: ColumnIntrospector
  defaultDb: string
  logger?: Logger
  /** Phase 3 consumer: the in-memory cursor captured before `state.fork()` ran. */
  syncCurrent?: BlockCursor
}

/**
 * Walks the declared `RollbackTarget[]`, invokes `runMonolithicCleanup` for
 * each (Phase 1), and returns the list of tables handled so callers can thread
 * `skippedTables` into the user's `onRollback` hook.
 *
 * In Phase 1 the probe (Phase 2) and chunking (Phase 3) are not yet wired — a
 * target with `cursorColumn` is still handled via the monolithic path. Later
 * phases extend this function to pick the chunked path when `cursorColumn` is
 * present and the Phase-0 gate is passed.
 */
export async function runManagedRollback(
  targets: RollbackTarget[],
  reason: RollbackReason,
  safeCursor: BlockCursor | undefined,
  ctx: ManagedRollbackContext,
): Promise<{ skippedTables: string[]; results: RollbackResult[] }> {
  const skippedTables: string[] = []
  const results: RollbackResult[] = []
  for (const target of targets) {
    const { db, unqualifiedTable, qualifiedTable } = resolveTargetTable(target.table, ctx.defaultDb)
    const result = await dispatchRollback({
      store: ctx.store,
      introspector: ctx.introspector,
      db,
      table: qualifiedTable,
      unqualifiedTable,
      scopeWhere: target.scopeWhere,
      cursorColumn: target.cursorColumn,
      safeCursor,
      queryParams: target.params,
      logger: ctx.logger,
    })
    ctx.logger?.debug?.(
      { event: `rollback.${result.kind}`, reason, safeCursor, table: qualifiedTable },
      `managed rollback ${result.kind} path complete`,
    )
    skippedTables.push(qualifiedTable)
    results.push(result)
  }
  return { skippedTables, results }
}

// ────────────────────────────────────────────────────────────────────────────
// Init-time validation (Phase 1 Step 5 + Phase 3 Step 11 — scope isolation)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the DDL `sorting_key` for a table and asserts `cursorColumn` appears
 * anywhere in it. Throws a user-actionable error otherwise (R-E fail-loud).
 */
export async function assertCursorColumnInSortKey(params: {
  store: ClickhouseStore
  db: string
  unqualifiedTable: string
  cursorColumn: string
}): Promise<void> {
  const { store, db, unqualifiedTable, cursorColumn } = params
  const res = await store.query({
    query: `
      SELECT sorting_key
      FROM system.tables
      WHERE database = {db:String} AND name = {tbl:String}
    `,
    format: 'JSONEachRow',
    query_params: { db, tbl: unqualifiedTable },
  })
  const rows = await res.json<{ sorting_key: string }>()
  if (rows.length === 0) {
    throw new Error(
      `clickhouseTarget: table ${db}.${unqualifiedTable} not found in system.tables (cannot validate cursorColumn='${cursorColumn}').`,
    )
  }
  const sortingKey = rows[0]!.sorting_key
  if (!cursorColumnIsInSortKey(sortingKey, cursorColumn)) {
    throw new Error(
      `clickhouseTarget: cursorColumn '${cursorColumn}' is not referenced anywhere in the ORDER BY of ${db}.${unqualifiedTable} (ORDER BY: ${sortingKey}). Either add '${cursorColumn}' to ORDER BY (or to an ORDER BY expression's operands) or omit cursorColumn to use the monolithic-cleanup path.`,
    )
  }
}

/**
 * PC-4 multi-writer scope enforcement (Phase 3 Step 11 / B10). When multiple
 * rollback targets share the same `table`, every target for that table MUST
 * have a non-empty `scopeWhere` — otherwise cross-writer tombstoning is
 * possible. Single-writer case (one target on a table) allows empty scope.
 */
export function assertScopeIsolation(targets: RollbackTarget[]): void {
  const byTable = new Map<string, RollbackTarget[]>()
  for (const t of targets) {
    const list = byTable.get(t.table) ?? []
    list.push(t)
    byTable.set(t.table, list)
  }
  for (const [table, list] of byTable) {
    if (list.length > 1) {
      for (const t of list) {
        if (t.scopeWhere.trim().length === 0) {
          throw new Error(
            `clickhouseTarget: table '${table}' is declared by multiple rollback targets; scopeWhere is required on each to isolate writers. Empty scope would cause cross-writer tombstoning.`,
          )
        }
      }
    }
  }
}

/**
 * Runs the full init-time validation: scope isolation + (per-target) sort-key
 * check where `cursorColumn` is declared.
 */
export async function validateRollbackTargets(params: {
  store: ClickhouseStore
  defaultDb: string
  targets: RollbackTarget[]
}): Promise<void> {
  const { store, defaultDb, targets } = params
  if (targets.length === 0) return
  assertScopeIsolation(targets)
  for (const target of targets) {
    if (!target.cursorColumn) continue
    const { db, unqualifiedTable } = resolveTargetTable(target.table, defaultDb)
    await assertCursorColumnInSortKey({
      store,
      db,
      unqualifiedTable,
      cursorColumn: target.cursorColumn,
    })
  }
}
