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

/**
 * Declarative rollback config. When `targets` is non-empty, the SDK runs a
 * managed rollback path for each target on `offset_check` and `blockchain_fork`
 * and `onRollback` receives the list of tables the SDK already handled via
 * `skippedTables` so user code can skip them.
 */
export type RollbackSettings = {
  /** Tables to manage. Each target with `cursorColumn` opts into chunked + resumable rollback. */
  targets?: RollbackTarget[]
  /**
   * Max in-flight tombstone INSERTs per (client, database). Default `2`. The
   * semaphore bounds parallelism regardless of how many pipes share the client.
   */
  concurrency?: number
  /** Row-window size for the chunked path. Default `500_000`. Ignored for monolithic and short-circuit paths. */
  chunkSize?: number
  /**
   * Jittered backoff for (a) the semaphore wake-up on release and (b) the
   * optional `PortalSource.forkRetryBackoff` knob. Actual delay
   * `baseMs * (0.5 + Math.random() * jitter * 2)`; default `baseMs=250, jitter=0.5`.
   */
  retryBackoff?: { baseMs?: number; jitter?: number }
  /** Name of the per-database checkpoint table used by the chunked path. Default `_sqd_rollback_checkpoint`. */
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

/** Structured log event emitted at the start of every rollback invocation (Phase 5 Step 1). */
export type RollbackStartEvent = {
  event: 'rollback.start'
  stream: string | null
  table: string
  reason: RollbackReason | null
  cursorColumn: string | null
  safeCursor: number | null
  probeKind: 'exists' | 'none'
}

/** Structured log event emitted per chunk. Only produced when `kind === 'chunked'`. */
export type RollbackChunkEvent = {
  event: 'rollback.chunk'
  stream: string | null
  table: string
  chunkIndex: number
  chunkFrom: number
  chunkTo: number
  durationMs: number
}

/** Structured log event emitted at the end of every rollback invocation, discriminated on `RollbackResult.kind`. */
export type RollbackEndEvent =
  | { event: 'rollback.end'; kind: 'short_circuit'; stream: string | null; table: string; totalDurationMs: number }
  | { event: 'rollback.end'; kind: 'monolithic'; stream: string | null; table: string; totalDurationMs: number }
  | {
      event: 'rollback.end'
      kind: 'chunked'
      stream: string | null
      table: string
      chunksPlanned: number
      chunksCompleted: number
      resumed: boolean
      totalDurationMs: number
    }

export type RollbackLogEvent = RollbackStartEvent | RollbackChunkEvent | RollbackEndEvent

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
// Concurrency gate + jittered backoff (Phase 4 Step 1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute a jittered delay `base * (0.5 + random * jitter * 2)`. For the
 * default `jitter = 0.5`, the output falls in `[0.5×base, 1.5×base]`.
 */
export function jitteredBackoff(baseMs: number, jitter: number, rng: () => number = Math.random): number {
  return baseMs * (0.5 + rng() * jitter * 2)
}

/**
 * Async semaphore with jittered post-release wake-up. `acquire()` returns a
 * release function; the contract is strictly one release per acquire.
 *
 * When a slot frees, the oldest waiter is scheduled to resume after a random
 * jittered delay — this prevents the thundering-herd on release, distinct
 * from the concurrency cap which prevents the in-flight stampede.
 */
export class RollbackSemaphore {
  #inFlight = 0
  #waiters: Array<() => void> = []
  readonly #concurrency: number
  readonly #baseMs: number
  readonly #jitter: number
  readonly #rng: () => number

  constructor(params: { concurrency: number; baseMs: number; jitter: number; rng?: () => number }) {
    if (params.concurrency < 1) throw new Error('RollbackSemaphore concurrency must be >= 1')
    this.#concurrency = params.concurrency
    this.#baseMs = params.baseMs
    this.#jitter = params.jitter
    this.#rng = params.rng ?? Math.random
  }

  /** Test-only: current in-flight count. */
  get inFlight(): number {
    return this.#inFlight
  }

  async acquire(): Promise<() => void> {
    if (this.#inFlight < this.#concurrency) {
      this.#inFlight++
      return () => this.#release()
    }
    await new Promise<void>((resolve) => this.#waiters.push(resolve))
    this.#inFlight++
    return () => this.#release()
  }

  #release() {
    this.#inFlight--
    const next = this.#waiters.shift()
    if (!next) return
    const delay = jitteredBackoff(this.#baseMs, this.#jitter, this.#rng)
    setTimeout(next, Math.max(0, delay))
  }
}

/**
 * Module-level registry of semaphores keyed by the `(client, database)`
 * identity tuple.
 */
const semaphoreRegistry = new WeakMap<object, Map<string, RollbackSemaphore>>()

export function getRollbackSemaphore(params: {
  client: object
  db: string
  concurrency: number
  baseMs: number
  jitter: number
}): RollbackSemaphore {
  const { client, db, concurrency, baseMs, jitter } = params
  let perClient = semaphoreRegistry.get(client)
  if (!perClient) {
    perClient = new Map()
    semaphoreRegistry.set(client, perClient)
  }
  const existing = perClient.get(db)
  if (existing) return existing
  const s = new RollbackSemaphore({ concurrency, baseMs, jitter })
  perClient.set(db, s)
  return s
}

/** Test-only: clear the semaphore registry. */
export function resetRollbackSemaphoreRegistry() {
  // WeakMap has no clear; replace by creating a new one would break references.
  // Tests instead construct a fresh RollbackSemaphore directly.
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
  semaphore?: RollbackSemaphore
}): Promise<RollbackResult> {
  const { store, introspector, db, table, unqualifiedTable, scopeWhere, queryParams, semaphore } = params

  const attempt = async () => {
    const columns = await introspector.columnsFor(db, unqualifiedTable)
    const sql = buildMonolithicInsertSelectSql({ table, columns, scopeWhere })
    const release = semaphore ? await semaphore.acquire() : undefined
    try {
      await store.command({ query: sql, query_params: queryParams })
    } finally {
      release?.()
    }
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
// Chunked + resumable rollback (Phase 3)
// ────────────────────────────────────────────────────────────────────────────

/** Per-chunk half-open window `(chunkFrom, chunkTo]`. Symmetric with probe's `> safeCursor`. */
export type ChunkBounds = { chunkFrom: number; chunkTo: number }

/**
 * Compute the chunk tiling for `(safeCursor, maxCursor]` with `chunkSize`.
 * Chunk n covers `(safeCursor + n*size, min(safeCursor + (n+1)*size, maxCursor)]`.
 * Empty range (`maxCursor <= safeCursor`) yields `totalChunks = 0`.
 */
export function computeChunkBounds(params: { safeCursor: number; maxCursor: number; chunkSize: number }): {
  totalChunks: number
  chunks: ChunkBounds[]
} {
  const { safeCursor, maxCursor, chunkSize } = params
  if (chunkSize <= 0) throw new Error('clickhouseTarget: chunkSize must be > 0')
  const total = maxCursor - safeCursor
  if (total <= 0) return { totalChunks: 0, chunks: [] }
  const totalChunks = Math.ceil(total / chunkSize)
  const chunks: ChunkBounds[] = []
  for (let n = 0; n < totalChunks; n++) {
    const chunkFrom = safeCursor + chunkSize * n
    const chunkTo = Math.min(chunkFrom + chunkSize, maxCursor)
    chunks.push({ chunkFrom, chunkTo })
  }
  return { totalChunks, chunks }
}

/** Derive `max_cursor` for the `offset_check` path via a bounded MAX query (no FINAL). */
export async function deriveMaxCursorOffsetCheck(params: {
  store: ClickhouseStore
  table: string
  scopeWhere: string
  cursorColumn: string
  safeCursor: BlockCursor
  queryParams?: Record<string, unknown>
}): Promise<number> {
  const { store, table, scopeWhere, cursorColumn, safeCursor, queryParams } = params
  const sql = `SELECT coalesce(max({cursorColumn:Identifier}), {safeCursor:UInt64}) AS m
FROM ${table}
WHERE (${scopeWhere})
  AND {cursorColumn:Identifier} > {safeCursor:UInt64}`
  const res = await store.query({
    query: sql,
    format: 'JSONEachRow',
    query_params: { ...(queryParams ?? {}), cursorColumn, safeCursor: safeCursor.number },
  })
  const rows = await res.json<{ m: string | number }>()
  if (rows.length === 0) return safeCursor.number
  return Number(rows[0]!.m)
}

/**
 * Derive `max_cursor` for the `blockchain_fork` path. Never queries the store —
 * returns `syncCurrent.number` captured at fork-handler entry via
 * `state.snapshotCurrent()` (R-B freeze).
 */
export function deriveMaxCursorBlockchainFork(params: { syncCurrent: BlockCursor }): number {
  return params.syncCurrent.number
}

/** Sanitize a stream/table identifier to `[a-z0-9_]` form for snapshot-table naming (5b). */
export function sanitizeIdentifier(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

/** Build the chunk-snapshot temp-table name used by Phase-0 branch (b) / Step 5b. */
export function snapshotTableName(params: { streamSafe: string; tableSafe: string; startedAtUnix: number }): string {
  const { streamSafe, tableSafe, startedAtUnix } = params
  return `_sqd_chunk_snapshot_${streamSafe}_${tableSafe}_${startedAtUnix}`
}

/** Build the anchored regex pattern that matches orphan snapshot tables for a (stream, table) pair. */
export function snapshotOrphanPattern(streamSafe: string, tableSafe: string): string {
  return `^_sqd_chunk_snapshot_${streamSafe}_${tableSafe}_[0-9]+$`
}

/** DDL for the checkpoint table. */
export function buildCheckpointTableDDL(qualifiedTable: string): string {
  return `CREATE TABLE IF NOT EXISTS ${qualifiedTable}
(
  stream              String,
  table_name          String,
  started_at          DateTime,
  safe_cursor         UInt64,
  max_cursor          UInt64,
  chunk_size          UInt64,
  last_completed_chunk Int64,
  sign                Int8
) ENGINE = CollapsingMergeTree(sign)
  ORDER BY (stream, table_name, started_at)
  TTL started_at + INTERVAL 7 DAY`
}

type CheckpointRow = {
  stream: string
  table_name: string
  safe_cursor: number
  max_cursor: number
  chunk_size: number
  last_completed_chunk: number
  started_at_unix: number
}

/**
 * Lazy `CREATE TABLE IF NOT EXISTS` for the per-database checkpoint table.
 * Caches the "already created" flag by `(store, db, checkpointTable)` so a
 * hot rollback path doesn't re-issue DDL every invocation.
 */
export class CheckpointTableEnsurer {
  #created = new Set<string>()

  async ensure(params: { store: ClickhouseStore; db: string; checkpointTable: string }): Promise<string> {
    const { store, db, checkpointTable } = params
    const qualified = `"${db}"."${checkpointTable}"`
    const key = `${db}.${checkpointTable}`
    if (this.#created.has(key)) return qualified
    await store.command({ query: buildCheckpointTableDDL(qualified) })
    this.#created.add(key)
    return qualified
  }

  /** Test-only: clears the per-(db, table) created cache. */
  reset() {
    this.#created.clear()
  }
}

async function readCheckpoint(params: {
  store: ClickhouseStore
  qualifiedCheckpointTable: string
  stream: string
  tableName: string
}): Promise<CheckpointRow | null> {
  const { store, qualifiedCheckpointTable, stream, tableName } = params
  const res = await store.query({
    query: `SELECT stream, table_name, safe_cursor, max_cursor, chunk_size, last_completed_chunk,
       toUnixTimestamp(started_at) AS started_at_unix
FROM ${qualifiedCheckpointTable} FINAL
WHERE stream = {stream:String} AND table_name = {table:String}
ORDER BY started_at DESC
LIMIT 1`,
    format: 'JSONEachRow',
    query_params: { stream, table: tableName },
  })
  const rows = await res.json<{
    stream: string
    table_name: string
    safe_cursor: string | number
    max_cursor: string | number
    chunk_size: string | number
    last_completed_chunk: string | number
    started_at_unix: string | number
  }>()
  if (rows.length === 0) return null
  const r = rows[0]!
  return {
    stream: r.stream,
    table_name: r.table_name,
    safe_cursor: Number(r.safe_cursor),
    max_cursor: Number(r.max_cursor),
    chunk_size: Number(r.chunk_size),
    last_completed_chunk: Number(r.last_completed_chunk),
    started_at_unix: Number(r.started_at_unix),
  }
}

async function writeInitialCheckpoint(params: {
  store: ClickhouseStore
  qualifiedCheckpointTable: string
  row: Omit<CheckpointRow, 'started_at_unix' | 'last_completed_chunk'>
  startedAtUnix: number
}): Promise<void> {
  const { store, qualifiedCheckpointTable, row, startedAtUnix } = params
  await store.command({
    query: `INSERT INTO ${qualifiedCheckpointTable}
(stream, table_name, started_at, safe_cursor, max_cursor, chunk_size, last_completed_chunk, sign)
VALUES ({stream:String}, {table:String}, fromUnixTimestamp({startedAtUnix:UInt32}),
        {safeCursor:UInt64}, {maxCursor:UInt64}, {chunkSize:UInt64}, -1, 1)`,
    query_params: {
      stream: row.stream,
      table: row.table_name,
      startedAtUnix,
      safeCursor: row.safe_cursor,
      maxCursor: row.max_cursor,
      chunkSize: row.chunk_size,
    },
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
  })
}

async function advanceCheckpoint(params: {
  store: ClickhouseStore
  qualifiedCheckpointTable: string
  row: Omit<CheckpointRow, 'started_at_unix' | 'last_completed_chunk'>
  startedAtUnix: number
  prev: number
  next: number
}): Promise<void> {
  const { store, qualifiedCheckpointTable, row, startedAtUnix, prev, next } = params
  // Two-row INSERT: sign=-1 on prev, sign=+1 on next. Non-sign columns byte-equal.
  await store.command({
    query: `INSERT INTO ${qualifiedCheckpointTable}
(stream, table_name, started_at, safe_cursor, max_cursor, chunk_size, last_completed_chunk, sign)
VALUES
  ({stream:String}, {table:String}, fromUnixTimestamp({startedAtUnix:UInt32}),
   {safeCursor:UInt64}, {maxCursor:UInt64}, {chunkSize:UInt64}, {prev:Int64}, -1),
  ({stream:String}, {table:String}, fromUnixTimestamp({startedAtUnix:UInt32}),
   {safeCursor:UInt64}, {maxCursor:UInt64}, {chunkSize:UInt64}, {next:Int64}, 1)`,
    query_params: {
      stream: row.stream,
      table: row.table_name,
      startedAtUnix,
      safeCursor: row.safe_cursor,
      maxCursor: row.max_cursor,
      chunkSize: row.chunk_size,
      prev,
      next,
    },
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
  })
}

async function retireCheckpoint(params: {
  store: ClickhouseStore
  qualifiedCheckpointTable: string
  row: Omit<CheckpointRow, 'started_at_unix'>
  startedAtUnix: number
}): Promise<void> {
  const { store, qualifiedCheckpointTable, row, startedAtUnix } = params
  await store.command({
    query: `INSERT INTO ${qualifiedCheckpointTable}
(stream, table_name, started_at, safe_cursor, max_cursor, chunk_size, last_completed_chunk, sign)
VALUES ({stream:String}, {table:String}, fromUnixTimestamp({startedAtUnix:UInt32}),
        {safeCursor:UInt64}, {maxCursor:UInt64}, {chunkSize:UInt64}, {last:Int64}, -1)`,
    query_params: {
      stream: row.stream,
      table: row.table_name,
      startedAtUnix,
      safeCursor: row.safe_cursor,
      maxCursor: row.max_cursor,
      chunkSize: row.chunk_size,
      last: row.last_completed_chunk,
    },
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
  })
}

/**
 * Build the per-chunk INSERT SELECT FINAL statement (Phase 3 Step 5a —
 * provisional Phase-0 branch (a)). Chunk uses half-open `(chunkFrom, chunkTo]`.
 */
export function buildChunkInsertSelectSql(params: { table: string; columns: string[]; scopeWhere: string }): string {
  const { table, columns, scopeWhere } = params
  if (columns.length === 0) {
    throw new Error(`clickhouseTarget: no insertable columns resolved for table ${table}`)
  }
  const nonSignCols = columns.filter((c) => c !== 'sign')
  const colList = nonSignCols.join(', ')
  return `INSERT INTO ${table} (${colList}, sign)
SELECT ${colList}, -1 AS sign
FROM ${table} FINAL
WHERE (${scopeWhere})
  AND {cursorColumn:Identifier} >  {chunkFrom:UInt64}
  AND {cursorColumn:Identifier} <= {chunkTo:UInt64}`
}

export type ChunkedRollbackContext = {
  store: ClickhouseStore
  introspector: ColumnIntrospector
  ensurer: CheckpointTableEnsurer
  db: string
  table: string
  unqualifiedTable: string
  scopeWhere: string
  cursorColumn: string
  queryParams?: Record<string, unknown>
  stream: string
  chunkSize: number
  checkpointTable: string
  /** Required. For `offset_check` use `safeCursor` directly; for `blockchain_fork` the cursor is the fork-resolved one. */
  safeCursor: BlockCursor
  /** Required — which `max_cursor` derivation branch to pick. */
  reason: RollbackReason
  /** Only used when `reason === 'blockchain_fork'`. */
  syncCurrent?: BlockCursor
  logger?: Logger
  /** Optional Phase-4 in-process concurrency gate for each chunk INSERT SELECT. */
  semaphore?: RollbackSemaphore
}

/**
 * Orchestrates a chunked, resumable rollback for one target:
 *   1. ensure checkpoint table exists
 *   2. resume check (FINAL read)
 *   3. on fresh: derive `max_cursor` per `reason`, write initial checkpoint (sign=+1)
 *   4. chunk loop: INSERT SELECT FINAL per chunk, then atomic 2-row advance
 *   5. retire write (sign=-1)
 *   6. return `{kind: 'chunked', chunksPlanned, chunksCompleted, resumed}`
 *
 * PC-3 shortcut: if resume found `last_completed_chunk + 1 === totalChunks`,
 * skip the chunk loop and jump straight to retire.
 */
export async function runChunkedRollback(ctx: ChunkedRollbackContext): Promise<RollbackResult> {
  const {
    store,
    introspector,
    ensurer,
    db,
    table,
    unqualifiedTable,
    scopeWhere,
    cursorColumn,
    queryParams,
    stream,
    chunkSize,
    checkpointTable,
    safeCursor,
    reason,
    syncCurrent,
    logger,
    semaphore,
  } = ctx

  const qualifiedCheckpointTable = await ensurer.ensure({ store, db, checkpointTable })

  const existing = await readCheckpoint({
    store,
    qualifiedCheckpointTable,
    stream,
    tableName: table,
  })

  let resumed = false
  let safe_cursor: number
  let max_cursor: number
  let chunk_size: number
  let startedAtUnix: number
  let last_completed_chunk: number

  if (existing) {
    resumed = true
    safe_cursor = existing.safe_cursor
    max_cursor = existing.max_cursor
    chunk_size = existing.chunk_size
    last_completed_chunk = existing.last_completed_chunk
    startedAtUnix = existing.started_at_unix
  } else {
    // Fresh rollback: derive max_cursor per reason.
    if (reason === 'blockchain_fork') {
      if (!syncCurrent) {
        throw new Error('clickhouseTarget: blockchain_fork chunked rollback requires syncCurrent')
      }
      max_cursor = deriveMaxCursorBlockchainFork({ syncCurrent })
    } else {
      max_cursor = await deriveMaxCursorOffsetCheck({
        store,
        table,
        scopeWhere,
        cursorColumn,
        safeCursor,
        queryParams,
      })
    }
    safe_cursor = safeCursor.number
    chunk_size = chunkSize
    startedAtUnix = Math.floor(Date.now() / 1000)
    last_completed_chunk = -1

    await writeInitialCheckpoint({
      store,
      qualifiedCheckpointTable,
      row: {
        stream,
        table_name: table,
        safe_cursor,
        max_cursor,
        chunk_size,
      },
      startedAtUnix,
    })
  }

  const { totalChunks, chunks } = computeChunkBounds({
    safeCursor: safe_cursor,
    maxCursor: max_cursor,
    chunkSize: chunk_size,
  })

  const columns = await introspector.columnsFor(db, unqualifiedTable)
  const chunkSql = buildChunkInsertSelectSql({ table, columns, scopeWhere })

  let chunksCompleted = 0
  const nextChunkIndex = last_completed_chunk + 1

  // PC-3 shortcut: if fully completed before crash, skip chunk loop.
  if (nextChunkIndex < totalChunks) {
    for (let n = nextChunkIndex; n < totalChunks; n++) {
      const { chunkFrom, chunkTo } = chunks[n]!
      const release = semaphore ? await semaphore.acquire() : undefined
      const chunkStartedAtMs = Date.now()
      try {
        await store.command({
          query: chunkSql,
          query_params: {
            ...(queryParams ?? {}),
            cursorColumn,
            chunkFrom,
            chunkTo,
          },
        })
      } finally {
        release?.()
      }
      await advanceCheckpoint({
        store,
        qualifiedCheckpointTable,
        row: {
          stream,
          table_name: table,
          safe_cursor,
          max_cursor,
          chunk_size,
        },
        startedAtUnix,
        prev: last_completed_chunk,
        next: n,
      })
      const chunkEvent: RollbackChunkEvent = {
        event: 'rollback.chunk',
        stream,
        table,
        chunkIndex: n,
        chunkFrom,
        chunkTo,
        durationMs: Date.now() - chunkStartedAtMs,
      }
      logger?.info?.(chunkEvent, 'rollback chunk')
      last_completed_chunk = n
      chunksCompleted++
    }
  }

  await retireCheckpoint({
    store,
    qualifiedCheckpointTable,
    row: {
      stream,
      table_name: table,
      safe_cursor,
      max_cursor,
      chunk_size,
      last_completed_chunk,
    },
    startedAtUnix,
  })

  return {
    kind: 'chunked',
    table,
    chunksPlanned: totalChunks,
    chunksCompleted,
    resumed,
  }
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
/**
 * Opt-in chunked-path configuration. Only the SDK-managed rollback populates
 * this; the user-facing `store.removeAllRows` leaves it undefined and gets
 * probe + monolithic behavior.
 */
export type ChunkedDispatchConfig = {
  ensurer: CheckpointTableEnsurer
  stream: string
  chunkSize: number
  checkpointTable: string
  reason: RollbackReason
  syncCurrent?: BlockCursor
}

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
  chunked?: ChunkedDispatchConfig
  semaphore?: RollbackSemaphore
  /** Optional `reason` for structured logs. Populated by the managed path; undefined for direct `removeAllRows`. */
  reason?: RollbackReason
  /** Optional stream identifier for structured logs. Populated by the managed path. */
  stream?: string
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
    chunked,
    semaphore,
    reason,
    stream,
  } = params

  const probeKind: 'exists' | 'none' = cursorColumn != null ? 'exists' : 'none'
  const startEvent: RollbackStartEvent = {
    event: 'rollback.start',
    stream: stream ?? null,
    table,
    reason: reason ?? null,
    cursorColumn: cursorColumn ?? null,
    safeCursor: safeCursor?.number ?? null,
    probeKind,
  }
  logger?.info?.(startEvent, 'rollback start')
  const startedAtMs = Date.now()

  const emitEnd = (result: RollbackResult) => {
    const totalDurationMs = Date.now() - startedAtMs
    const end: RollbackEndEvent =
      result.kind === 'chunked'
        ? {
            event: 'rollback.end',
            kind: 'chunked',
            stream: stream ?? null,
            table,
            chunksPlanned: result.chunksPlanned,
            chunksCompleted: result.chunksCompleted,
            resumed: result.resumed,
            totalDurationMs,
          }
        : {
            event: 'rollback.end',
            kind: result.kind,
            stream: stream ?? null,
            table,
            totalDurationMs,
          }
    logger?.info?.(end, 'rollback end')
  }

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
      const result: RollbackResult = { kind: 'short_circuit', table }
      emitEnd(result)
      return result
    }

    if (chunked) {
      const result = await runChunkedRollback({
        store,
        introspector,
        ensurer: chunked.ensurer,
        db,
        table,
        unqualifiedTable,
        scopeWhere,
        cursorColumn,
        queryParams,
        stream: chunked.stream,
        chunkSize: chunked.chunkSize,
        checkpointTable: chunked.checkpointTable,
        safeCursor,
        reason: chunked.reason,
        syncCurrent: chunked.syncCurrent,
        logger,
        semaphore,
      })
      emitEnd(result)
      return result
    }
  }

  const result = await runMonolithicCleanup({
    store,
    introspector,
    db,
    table,
    unqualifiedTable,
    scopeWhere,
    queryParams,
    semaphore,
  })
  emitEnd(result)
  return result
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
  /** Phase 3: required when any target has a `cursorColumn`. */
  chunked?: {
    ensurer: CheckpointTableEnsurer
    stream: string
    chunkSize: number
    checkpointTable: string
  }
  /** Phase 4: in-process concurrency gate. */
  semaphore?: RollbackSemaphore
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
    const chunkedCfg: ChunkedDispatchConfig | undefined =
      ctx.chunked && target.cursorColumn
        ? {
            ensurer: ctx.chunked.ensurer,
            stream: ctx.chunked.stream,
            chunkSize: ctx.chunked.chunkSize,
            checkpointTable: ctx.chunked.checkpointTable,
            reason,
            syncCurrent: ctx.syncCurrent,
          }
        : undefined

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
      chunked: chunkedCfg,
      semaphore: ctx.semaphore,
      reason,
      stream: ctx.chunked?.stream,
    })
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
