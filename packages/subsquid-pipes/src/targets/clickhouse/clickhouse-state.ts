import {
  BatchContext,
  BlockCursor,
  Logger,
  Profiler,
  RollbackRecord,
  TargetState,
  coerceFinalized,
  resolveForkCursor,
} from '~/core/index.js'

import { ClickhouseStore } from './clickhouse-store.js'

// FIXME: we need refactor it to make order more deterministic and predictable - WHY?
// ORDER BY (timestamp, id) isn't a good choice
const table = (table: string) => `
CREATE TABLE IF NOT EXISTS ${table}
(
    id               String COMMENT 'Stream identifier to differentiate multiple logical streams',
    current          String COMMENT 'Current offset, corresponds to the most recent indexed block',
    finalized        String COMMENT 'Finalized offset, usually corresponds to the most recent known block',
    rollback_chain   String COMMENT 'JSON-encoded list of block references starting from the finalized block and including all unfinalized blocks',
    timestamp        DateTime(3) COMMENT 'Timestamp of the record, in milliseconds with 3 decimal precision',
    sign             Int8 COMMENT 'Marker used by CollapsingMergeTree to distinguish insertions (+1) and deletions (-1)'
) ENGINE = CollapsingMergeTree(sign)
  ORDER BY (timestamp, id)
`

/**
 * The key `options.id` falls back to, and the key used before `bindCursorKey` resolves the source
 * id (e.g. unit tests that drive the state directly). Migrating an old cursor stored under this id
 * is opt-in via `migrateFromId` — it is never read automatically.
 */
const LEGACY_DEFAULT_ID = 'stream'

/**
 * Configuration options for ClickhouseState.
 */
export type Options = {
  /**
   * Name of the ClickHouse database to use.
   * Defaults to "default" if not provided.
   */
  database?: string

  /**
   * Name of the table to store offset data.
   */
  table?: string

  /**
   * Stream identifier used to isolate offset records within the same table.
   * Defaults to the pipe's source `id`. Set explicitly only to pin a cursor key
   * independent of the source id (e.g. several pipes writing to one table).
   */
  id?: string

  /**
   * One-time migration: if set, and no cursor exists yet under this pipe's key, resume once from a
   * cursor stored under this (older) id and migrate progress forward. Set to `"stream"` when
   * upgrading a pipe from an SDK version that keyed progress by the default `"stream"` id. Off by
   * default so a new pipe never inherits a foreign cursor left in a shared table.
   */
  migrateFromId?: string

  /**
   * Maximum number of rows to retain per unique stream id in the offset table.
   * Older rows beyond this count will be removed.
   * Default is 10,000.
   */
  maxRows?: number
}

export class ClickhouseState {
  options: Options & Required<Pick<Options, 'database' | 'id' | 'table' | 'maxRows'>>

  readonly #qualifiedName: string
  #saves = 0

  // The id every cursor row is keyed by: an explicit `settings.id`, else the pipe's source id
  // once `bindCursorKey` runs, else the default (e.g. when bind never runs in unit tests).
  #cursorKey: string
  readonly #explicitId: boolean
  readonly #migrateFromId?: string
  #logger?: Logger

  constructor(
    private store: ClickhouseStore,
    options: Options,
  ) {
    // Accessing connectionParams as any due to private typing in ClickHouseClient
    const client = store.client as any

    const maxRows = options.maxRows ?? 10_000
    if (maxRows <= 0) {
      throw new Error('Max rows must be greater than 0')
    }

    this.options = {
      database: client.connectionParams?.database || 'default',
      table: 'sync',
      ...options,
      // override after spread so an explicit `undefined` cannot clobber the defaults
      id: options.id ?? LEGACY_DEFAULT_ID,
      maxRows,
    }

    // An explicit id is honoured verbatim; otherwise the source id (bound later) becomes the key,
    // falling back to the default if `bindCursorKey` never runs.
    this.#explicitId = options.id !== undefined
    this.#cursorKey = this.options.id
    this.#migrateFromId = options.migrateFromId

    this.#qualifiedName = `"${this.options.database}"."${this.options.table}"`
  }

  /**
   * Resolve the cursor key from the pipe's source id, unless an explicit `settings.id` was given
   * (explicit always wins). Called once by the target before any read so getCursor, saveCursor and
   * fork all key by the same value. Legacy-cursor migration is separate and opt-in — see `migrateFromId`.
   */
  bindCursorKey(sourceId: string | undefined, logger?: Logger): void {
    this.#logger = logger

    if (this.#explicitId || !sourceId) return

    this.#cursorKey = sourceId
  }

  /** The id every cursor row is keyed by. Exposed for tests. */
  get cursorKey(): string {
    return this.#cursorKey
  }

  encodeCursor(cursor: BlockCursor | { number: number }): string {
    return JSON.stringify(cursor)
  }
  decodeCursor(cursor: string): BlockCursor {
    return JSON.parse(cursor)
  }

  async saveCursor(
    {
      stream: {
        state: { current, rollbackChain },
        head,
      },
      profiler,
    }: BatchContext,
    parentSpan: Profiler = profiler,
  ) {
    const timestamp = Date.now()

    await parentSpan.measure({ name: 'insert cursor', labels: 'db' }, async () => {
      await this.store.insert({
        table: this.#qualifiedName,
        values: [
          {
            id: this.#cursorKey,
            current: this.encodeCursor(current),
            // The source has already clamped this finalized head + rollback chain through the
            // pipe's monotonic watermark, so persisting them verbatim keeps the stored floor
            // non-regressing without any target-local clamp.
            finalized: head.finalized ? this.encodeCursor(head.finalized) : '',
            rollback_chain: JSON.stringify(rollbackChain),
            sign: 1,
            timestamp,
          },
        ],
        format: 'JSONEachRow',
      })
    })

    this.#saves++

    // Debounce cleanup for large retention windows, but enforce small limits
    // eagerly so `maxRows` stays an effective per-id bound after each save.
    // For maxRows < 25 we clean every save (overshoot is only 1 row); for the
    // common maxRows=10_000 case we clean every 25 saves (overshoot ≤ 0.25%).
    const cleanupInterval = this.options.maxRows < 25 ? 1 : 25

    if (this.#saves === 1 || this.#saves % cleanupInterval === 0) {
      await parentSpan.measure({ name: 'cleanup cursors', labels: 'db' }, async () => {
        // Filter by id so cleanup of one stream cannot evict another stream's rows
        // when multiple streams share the same offset table.
        await this.store.removeAllRowsByQuery({
          table: this.#qualifiedName,
          query: `
            SELECT *
            FROM ${this.#qualifiedName} FINAL
            WHERE id = {id:String}
            ORDER BY "timestamp" DESC
            OFFSET ${this.options.maxRows}
          `,
          params: { id: this.#cursorKey },
        })
      })
    }
  }

  async getCursor(): Promise<TargetState | undefined> {
    try {
      const primary = await this.#readLatest(this.#cursorKey)
      if (primary) return primary

      // Opt-in migration: when `migrateFromId` is set and this pipe has no cursor of its own yet,
      // resume once from the older id and let the next saveCursor rewrite under the current key.
      // Off by default, so a new pipe never inherits a foreign cursor left in a shared table.
      if (this.#migrateFromId && this.#migrateFromId !== this.#cursorKey) {
        const previous = await this.#readLatest(this.#migrateFromId)
        if (previous) {
          this.#logger?.warn(
            `No ClickHouse cursor under id "${this.#cursorKey}"; resuming once from the cursor stored ` +
              `under "${this.#migrateFromId}" (migrateFromId) and migrating progress to "${this.#cursorKey}".`,
          )

          return previous
        }
      }

      return
    } catch (e: unknown) {
      if (e instanceof Error && 'type' in e && e.type === 'UNKNOWN_TABLE') {
        await this.store.command({ query: table(this.#qualifiedName) })

        return
      }

      throw e
    }
  }

  async #readLatest(id: string): Promise<TargetState | undefined> {
    const res = await this.store.query({
      query: `SELECT * FROM ${this.#qualifiedName} WHERE id = {id:String} ORDER BY timestamp DESC LIMIT 1`,
      format: 'JSONEachRow',
      query_params: { id },
    })

    const [row] = await res.json<{ current: string; finalized: string }>()
    if (!row) return

    // Hand the persisted finalized head back as resume state so the source can seed its monotonic
    // watermark (survives an unclean restart mid-fork). It is the newest row's floor — a higher
    // finalized left by a pre-fix regression in an older row is not recovered; a defensive
    // max-across-rows seed is deferred (PR #88 review). Explicit `null` when none was ever stored.
    return {
      latest: this.decodeCursor(row.current),
      finalized: coerceFinalized(row.finalized ? this.decodeCursor(row.finalized) : undefined) ?? null,
    }
  }

  async fork(previousBlocks: BlockCursor[]): Promise<BlockCursor | null> {
    let primaryHadRows = false
    const resolved = await resolveForkCursor(
      this.#records(this.#cursorKey, () => {
        primaryHadRows = true
      }),
      previousBlocks,
    )

    // Found a safe cursor, or the pipe's own rows just didn't resolve one — either way don't fall
    // back. Only with opt-in `migrateFromId`, and only when this pipe has no rows yet (mid-migration,
    // before its first save under the current key), do we scan the older rollback chain instead.
    if (resolved !== null || primaryHadRows || !this.#migrateFromId || this.#migrateFromId === this.#cursorKey) {
      return resolved
    }

    return resolveForkCursor(this.#records(this.#migrateFromId), previousBlocks)
  }

  async *#records(id: string, onRow?: () => void): AsyncIterable<RollbackRecord> {
    // Filter by id (like getCursor and cleanup do): when multiple streams share one sync table,
    // an unfiltered scan would mix other streams' rollback chains into this fork's resolution and
    // could resolve to a foreign cursor, corrupting the rollback.
    const res = await this.store.query({
      query: `SELECT * FROM ${this.#qualifiedName} WHERE id = {id:String} ORDER BY "timestamp" DESC`,
      format: 'JSONEachRow',
      query_params: { id },
    })

    for await (const rows of res.stream<{ rollback_chain: string; finalized: string }>()) {
      for (const row of rows) {
        const raw = row.json()
        onRow?.()

        yield {
          rollbackChain: JSON.parse(raw.rollback_chain) as BlockCursor[],
          // A row persisted before the source reported any finalized head stores '' (and always
          // an empty rollback chain). Decode it to `undefined` so resolveForkCursor skips it
          // gracefully — matching the postgres/bigquery targets — instead of crashing on
          // JSON.parse('').
          finalized: raw.finalized ? (JSON.parse(raw.finalized) as BlockCursor) : undefined,
        }
      }
    }
  }
}
