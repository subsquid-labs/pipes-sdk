import { BatchCtx, BlockCursor } from '~/core/index.js'
import { parseNumber } from '~/internal/number.js'

const table = ({ qualifiedName, table }: { qualifiedName: string; table: string }) => `
CREATE TABLE IF NOT EXISTS ${qualifiedName}
(
    id                      text not null,
    current_number          numeric not null,
    current_hash            text    not null,
    "current_timestamp"     int4,
    finalized               jsonb,
    rollback_chain          jsonb,
    CONSTRAINT "${table}_pk" PRIMARY KEY("current_number", "id")
);
COMMENT ON COLUMN ${qualifiedName}."id" IS
    'Stream identifier used to separate state records within the same table.';

COMMENT ON COLUMN ${qualifiedName}."current_number" IS
    'The block number of the current processed block. Acts as part of the primary key.';

COMMENT ON COLUMN ${qualifiedName}."current_hash" IS
    'The block hash of the current processed block. Used together with current_number to uniquely identify the block.';

COMMENT ON COLUMN ${qualifiedName}."current_timestamp" IS
    'Timestamp when this state entry was recorded. Indicates when the cursor was persisted.';

COMMENT ON COLUMN ${qualifiedName}."finalized" IS
    'JSON structure representing the latest finalized block returned by the chain head.';

COMMENT ON COLUMN ${qualifiedName}."rollback_chain" IS
    'JSON array of BlockCursor entries used for detecting forks and reconstructing rollback points.';
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
  current_number: string
  current_hash: string
  current_timestamp: string
  id: string
}>

interface PgClient {
  query<T = any>(query: string, params?: any[]): Promise<T>
}

/**
 * Configuration options for PostgresState.
 */
export type StateOptions = {
  /**
   * Name of the PostgreSQL schema to use.
   * Defaults to "public" if not provided.
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

  readonly #qualifiedTableName: string

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

    this.#qualifiedTableName = `"${this.options.schema}"."${this.options.table}"`
  }

  async saveCursor({ state: { current, rollbackChain }, head, logger }: BatchCtx) {
    const finalizedBlock = head.finalized?.number

    await this.client.query(
      `
        INSERT INTO ${this.#qualifiedTableName} 
        (id, current_number, current_hash, "current_timestamp", finalized, rollback_chain) 
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        this.options.id,
        current.number,
        current.hash,
        current.timestamp,
        JSON.stringify(head.finalized),
        JSON.stringify(rollbackChain),
      ],
    )

    // Clean up old unfinalized blocks beyond retention
    if (finalizedBlock && rollbackChain.length) {
      const safeBlockNumber = Math.max(finalizedBlock - this.options.unfinalizedBlocksRetention, 0)
      const res = await this.client.query<DeleteResult>(
        `DELETE
         FROM ${this.#qualifiedTableName}
         WHERE "id" = $1 AND "current_number" <= $2`,
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
        `SELECT * FROM ${this.#qualifiedTableName} WHERE id = $1 ORDER BY "current_number" DESC LIMIT 1`,
        [this.options.id],
      )
      const [row] = rows
      if (!row) return

      return {
        number: parseNumber(row.current_number),
        hash: row.current_hash,
        timestamp: row.current_timestamp ? parseNumber(row.current_timestamp) : undefined,
      }
    } catch (e: unknown) {
      if (e instanceof Error && 'code' in e && e.code === '42P01') {
        await this.client.query(
          table({
            qualifiedName: this.#qualifiedTableName,
            table: this.options.table,
          }),
        )
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
        `SELECT * FROM ${this.#qualifiedTableName} ORDER BY "current_number" DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
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
