import { BatchContext, BlockCursor, RollbackRecord, resolveForkCursor } from '~/core/index.js'

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
   * Defaults to "stream" if not provided.
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
      id: 'stream',
      ...options,
      // override after spread so an explicit `undefined` cannot clobber the default
      maxRows,
    }

    this.#qualifiedName = `"${this.options.database}"."${this.options.table}"`
  }

  encodeCursor(cursor: BlockCursor | { number: number }): string {
    return JSON.stringify(cursor)
  }
  decodeCursor(cursor: string): BlockCursor {
    return JSON.parse(cursor)
  }

  async saveCursor({
    stream: {
      state: { current, rollbackChain },
      head,
    },
  }: BatchContext) {
    const timestamp = Date.now()

    await this.store.insert({
      table: this.#qualifiedName,
      values: [
        {
          id: this.options.id,
          current: this.encodeCursor(current),
          finalized: head.finalized ? this.encodeCursor(head.finalized) : '',
          rollback_chain: JSON.stringify(rollbackChain),
          sign: 1,
          timestamp,
        },
      ],
      format: 'JSONEachRow',
    })

    this.#saves++

    // Debounce cleanup for large retention windows, but enforce small limits
    // eagerly so `maxRows` stays an effective per-id bound after each save.
    // For maxRows < 25 we clean every save (overshoot is only 1 row); for the
    // common maxRows=10_000 case we clean every 25 saves (overshoot ≤ 0.25%).
    const cleanupInterval = this.options.maxRows < 25 ? 1 : 25

    if (this.#saves === 1 || this.#saves % cleanupInterval === 0) {
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
        params: { id: this.options.id },
      })
    }
  }

  async getCursor(): Promise<BlockCursor | undefined> {
    try {
      const res = await this.store.query({
        query: `SELECT * FROM ${this.#qualifiedName} WHERE id = {id:String} ORDER BY timestamp DESC LIMIT 1`,
        format: 'JSONEachRow',
        query_params: { id: this.options.id },
      })

      const [row] = await res.json<{ current: string; initial: string }>()
      if (row) {
        return this.decodeCursor(row.current)
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

  async fork(previousBlocks: BlockCursor[]): Promise<BlockCursor | null> {
    const res = await this.store.query({
      query: `SELECT * FROM ${this.#qualifiedName} ORDER BY "timestamp" DESC`,
      format: 'JSONEachRow',
    })

    async function* records(): AsyncIterable<RollbackRecord> {
      for await (const rows of res.stream<{ rollback_chain: string; finalized: string }>()) {
        for (const row of rows) {
          const raw = row.json()
          yield {
            rollbackChain: JSON.parse(raw.rollback_chain) as BlockCursor[],
            finalized: JSON.parse(raw.finalized) as BlockCursor,
          }
        }
      }
    }

    return resolveForkCursor(records(), previousBlocks)
  }
}
