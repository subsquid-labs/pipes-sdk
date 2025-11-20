import { sql } from 'drizzle-orm'
import { BatchCtx, BlockCursor, Logger } from '~/core/index.js'
import { doWithRetry } from '~/internal/function.js'
import { parseNumber } from '~/internal/number.js'
import { Transaction } from '~/targets/drizzle/node-postgres/drizzle-target.js'
import { syncTable, tableNotExists } from '~/targets/drizzle/node-postgres/tables.js'

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
  current_timestamp: Date
  id: string
}>

interface PgClient {
  query<T = any>(query: string, params?: any[]): Promise<T>
}

/** @internal */
export type Table = {
  fqnName: string
  name: string
  schema: string
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

  readonly #sync: Table

  /** Internal counter to track the number of saves for cleanup operations. */
  #saves = 0

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

    this.#sync = {
      name: this.options.table,
      schema: this.options.schema,
      fqnName: `"${this.options.schema}"."${this.options.table}"`,
    }
  }

  /**
   * Acquires a PostgreSQL advisory lock for the current state ID using
   * the pg_try_advisory_xact_lock function. This ensures that only one
   * process can write to this state at a time. The lock is automatically
   * released at the end of the transaction.
   */
  async acquireLock(tx: Transaction): Promise<void> {
    const res = await tx.execute<{ got_lock: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${this.options.id})::bigint) AS got_lock;`,
    )

    if (res.rows[0]?.got_lock) return

    throw new Error(
      [
        `Could not acquire advisory lock for state id "${this.options.id}".`,
        `Another process might be holding the lock.`,
        `Please ensure that only one process is writing to this state at a time.`,
      ].join(' '),
    )
  }

  async saveCursor(tx: Transaction, { state: { current, rollbackChain }, head, logger }: BatchCtx) {
    const finalizedBlock = head.finalized?.number

    logger.debug(`Saving cursor at block ${current.number} for ${this.options.id} row...`)
    await tx.execute(
      sql`
        INSERT INTO ${sql.raw(this.#sync.fqnName)} (
           id, current_number, current_hash, "current_timestamp", finalized, rollback_chain
        ) 
        VALUES (
            ${this.options.id}, 
            ${current.number}, 
            ${current.hash}, 
            ${current.timestamp ? new Date(current.timestamp * 1000) : sql.raw('NULL')}, 
            ${JSON.stringify(head.finalized || {})}, 
            ${JSON.stringify(rollbackChain || [])}
        )
      `,
    )
    this.#saves++
    if (this.#saves === 1 || this.#saves % 25 === 0) {
      // Clean up old unfinalized blocks beyond retention
      const safeBlockNumber = Math.max(
        Math.min(current.number, finalizedBlock || Infinity) - this.options.unfinalizedBlocksRetention,
        0,
      )

      logger.info(`Cleaning up old offsets less than ${safeBlockNumber} block for ${this.options.id} row...`)

      const res = await tx.execute<DeleteResult>(sql`
        DELETE FROM ${sql.raw(this.#sync.fqnName)}    
        WHERE "id" = ${this.options.id} AND "current_number" <= ${safeBlockNumber}
      `)

      logger.debug(`Removed unused offsets from ${res.rowCount} rows from ${this.options.table}`)

      return { safeBlockNumber }
    }

    return {
      safeBlockNumber: -1,
    }
  }

  async getCursor({ logger }: { logger: Logger }): Promise<BlockCursor | undefined> {
    try {
      const { rows } = await this.client.query<StateSelect>(
        `SELECT * FROM ${this.#sync.fqnName} WHERE id = $1 ORDER BY "current_number" DESC LIMIT 1`,
        [this.options.id],
      )
      const [row] = rows
      if (!row) return

      return {
        number: parseNumber(row.current_number),
        hash: row.current_hash,
        timestamp: row.current_timestamp ? row.current_timestamp.getTime() / 1000 : undefined,
      }
    } catch (e) {
      if (!tableNotExists(e)) {
        throw e
      }

      logger.debug(`Creating table ${this.#sync.fqnName} for state management...`)
      await doWithRetry(() => this.client.query(syncTable(this.#sync)))
      logger.debug(`Table ${this.#sync.fqnName} created!`)
    }

    return
  }

  async fork(previousBlocks: BlockCursor[]): Promise<BlockCursor | null> {
    const PAGE_SIZE = 1000
    let offset = 0

    while (true) {
      const res = await this.client.query<StateSelect>(
        `SELECT * FROM ${this.#sync.fqnName} WHERE "id" = $1 ORDER BY "current_number" DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        [this.options.id],
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
