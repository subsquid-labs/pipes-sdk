import { BatchCtx, BlockCursor } from '~/core/index.js'

const table = (table: string) => `
CREATE TABLE IF NOT EXISTS ${table}
(
    id               text,
    current          jsonb,
    finalized        jsonb,
    rollback_chain   jsonb,
    timestamp        timestamptz
);
COMMENT ON COLUMN ${table}."id" IS 'Stream identifier to differentiate multiple logical streams';
COMMENT ON COLUMN ${table}."current" IS 'Current offset, corresponds to the most recent indexed block';
COMMENT ON COLUMN ${table}."finalized" IS 'Finalized offset, usually corresponds to the most recent known block';
COMMENT ON COLUMN ${table}."rollback_chain" IS 'JSON-encoded list of block references starting from the finalized block and including all unfinalized blocks';
COMMENT ON COLUMN ${table}."timestamp" IS 'Timestamp of the record';
`

type DeleteResult = {
  rowCount: number
}
type SelectResult<T> = {
  rows: T[]
}
type StateSelect = SelectResult<{
  rollback_chain: BlockCursor[]
  finalized: BlockCursor
  current: BlockCursor
  id: string
}>

interface PgClient {
  query<T = any>(query: string, params?: any[]): Promise<T>
}

/**
 * Configuration options for ClickhouseState.
 */
export type StateOptions = {
  /**
   * Name of the ClickHouse database to use.
   * Defaults to "default" if not provided.
   */
  schema?: string

  /**
   * Name of the table to store offset data.
   */
  table?: string

  /**
   * Stream identifier used to isolate offset records within the same table.
   * Defaults to "stream" if not provided.
   */
  id?: string

  unfinalizedBlocksRetention?: number
}

export class PostgresState {
  options: Required<StateOptions>

  readonly #fullTableName: string

  constructor(
    private client: PgClient,
    options?: StateOptions,
  ) {
    this.options = {
      schema: 'public',
      table: 'sync',
      id: 'stream',
      unfinalizedBlocksRetention: 1000,
      ...options,
    }

    if (this.options?.unfinalizedBlocksRetention && this.options?.unfinalizedBlocksRetention <= 0) {
      throw new Error('Retention strategy must be greater than 0')
    }

    this.#fullTableName = `"${this.options.schema}"."${this.options.table}"`
  }

  async saveCursor({ state: { current, rollbackChain }, head, logger }: BatchCtx) {
    const finalizedBlock = head.finalized?.number

    await this.client.query(
      `INSERT INTO ${this.#fullTableName} (id, current, finalized, rollback_chain, timestamp) VALUES ($1, $2, $3, $4, NOW())`,
      [
        this.options.id,
        //
        JSON.stringify(current),
        JSON.stringify(head.finalized),
        JSON.stringify(rollbackChain),
      ],
    )

    // Clean up old unfinalized blocks beyond retention
    if (finalizedBlock && rollbackChain.length) {
      const safeBlockNumber = Math.max(finalizedBlock - this.options.unfinalizedBlocksRetention, 0)
      const res = await this.client.query<DeleteResult>(
        `DELETE
         FROM ${this.#fullTableName}
         WHERE "id" = $1 AND "current" ->> 'number' <= $2`,
        [this.options.id, safeBlockNumber],
      )

      logger.debug(`Removed unused offsets from ${res.rowCount} rows from ${this.options.table}`)

      return { safeBlockNumber }
    }

    return {
      safeBlockNumber: -1,
    }
  }

  async getCursor(): Promise<BlockCursor | undefined> {
    try {
      const { rows } = await this.client.query<StateSelect>(
        `SELECT * FROM ${this.#fullTableName} WHERE id = $1 ORDER BY timestamp DESC LIMIT 1`,
        [this.options.id],
      )

      return rows[0]?.current
    } catch (e: unknown) {
      if (e instanceof Error && 'code' in e && e.code === '42P01') {
        await this.client.query(table(this.#fullTableName))
        return
      }

      throw e
    }
  }

  async fork(previousBlocks: BlockCursor[]): Promise<BlockCursor | null> {
    const PAGE_SIZE = 1000
    let offset = 0

    while (true) {
      const res = await this.client.query<StateSelect>(
        `SELECT * FROM ${this.#fullTableName} ORDER BY "timestamp" DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      )
      if (!res.rows.length) break

      for (const row of res.rows) {
        const blocks = row.rollback_chain
        if (!blocks) continue

        blocks.sort((a, b) => b.number - a.number)

        const finalized = row.finalized
        for (const block of blocks) {
          const found = previousBlocks.find((u) => u.number === block.number && u.hash === block.hash)
          if (found) return found

          if (!previousBlocks.length) {
            if (block.number < finalized.number) {
              /**
               *  We can't go beyond the finalized block.
               *  TODO: Dead end? What should we do?
               */

              return null
            }

            /*
             * This indicates a deep blockchain fork where we've exhausted all previously known blocks.
             * We'll return the current block as the fork point
             * and let the portal fetch a new valid chain of blocks.
             */
            return block
          }

          // Remove already visited blocks
          previousBlocks = previousBlocks.filter((u) => u.number < block.number)
        }
      }

      offset += PAGE_SIZE
    }

    return null
  }
}
