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
 * The static id every cursor was keyed by before the SDK keyed cursors by the pipe's source id.
 * Also the key `options.id` falls back to when `bindCursorKey` never runs (e.g. unit tests that
 * drive the state directly). A cursor left under this id by an older SDK is migrated to the
 * pipe's own key automatically on first resume — see `getCursor`.
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

    this.#qualifiedName = `"${this.options.database}"."${this.options.table}"`
  }

  /**
   * Resolve the cursor key from the pipe's source id, unless an explicit `settings.id` was given
   * (explicit always wins). Called once by the target before any read so getCursor, saveCursor and
   * fork all key by the same value.
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

      return await this.#migrateLegacyCursor()
    } catch (e: unknown) {
      if (e instanceof Error && 'type' in e && e.type === 'UNKNOWN_TABLE') {
        await this.store.command({ query: table(this.#qualifiedName) })

        return
      }

      throw e
    }
  }

  /**
   * Automatic one-time migration from the legacy default key. A pipe upgraded from an SDK version
   * that keyed every cursor by the static "stream" id finds its progress there — re-key those rows
   * under the pipe's own cursor key (timestamps preserved, so the rollback chain stays ordered for
   * fork resolution) and resume from the migrated cursor.
   *
   * Skipped when an explicit `settings.id` is set: an explicitly pinned key either already holds
   * its own rows or deliberately names a fresh cursor, and inheriting the shared legacy cursor
   * would be wrong. When several source-keyed pipes share one offset table, the first pipe to
   * start consumes the legacy rows; the others start fresh — under the legacy shared key only one
   * cursor ever existed anyway.
   */
  async #migrateLegacyCursor(): Promise<TargetState | undefined> {
    if (this.#explicitId || this.#cursorKey === LEGACY_DEFAULT_ID) return

    const legacy = await this.#readLatest(LEGACY_DEFAULT_ID)
    if (!legacy) return

    this.#logger?.warn(
      `Found a ClickHouse cursor under the legacy default id "${LEGACY_DEFAULT_ID}"; migrating its rows ` +
        `to this pipe's id "${this.#cursorKey}" and resuming from the migrated cursor.`,
    )

    await this.#rekeyLegacyRows()

    return legacy
  }

  /**
   * Physically move every legacy row to the current cursor key: re-insert each row with the new id
   * (same timestamp/sign), then cancel the originals via CollapsingMergeTree sign=-1 rows. A crash
   * between the two steps leaves the rows duplicated under both keys — harmless, since the next
   * start finds the primary cursor and never reads the legacy key again.
   */
  async #rekeyLegacyRows(): Promise<void> {
    const res = await this.store.query({
      query: `SELECT * FROM ${this.#qualifiedName} FINAL WHERE id = {id:String}`,
      format: 'JSONEachRow',
      query_params: { id: LEGACY_DEFAULT_ID },
      clickhouse_settings: {
        date_time_output_format: 'iso',
        output_format_json_quote_64bit_floats: 1,
        output_format_json_quote_64bit_integers: 1,
      },
    })

    for await (const rows of res.stream<Record<string, unknown>>()) {
      await this.store.insert({
        table: this.#qualifiedName,
        values: rows.map((row) => ({ ...(row.json() as Record<string, unknown>), id: this.#cursorKey })),
        format: 'JSONEachRow',
        clickhouse_settings: {
          date_time_input_format: 'best_effort',
        },
      })
    }

    await this.store.removeAllRowsByQuery({
      table: this.#qualifiedName,
      query: `SELECT * FROM ${this.#qualifiedName} FINAL WHERE id = {id:String}`,
      params: { id: LEGACY_DEFAULT_ID },
    })
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
    // Only the pipe's own rows participate: getCursor migrated any legacy-keyed rows to the
    // current key before the first read, so by fork time no other key can hold our chain.
    return resolveForkCursor(this.#records(this.#cursorKey), previousBlocks)
  }

  async *#records(id: string): AsyncIterable<RollbackRecord> {
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
