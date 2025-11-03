import { and, eq, Table } from 'drizzle-orm'
import { NodePgDatabase } from 'drizzle-orm/node-postgres/driver'
import { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres/session'
import { PgTransaction } from 'drizzle-orm/pg-core'
import { PgColumn } from 'drizzle-orm/pg-core/columns/common'

import { BlockCursor, Ctx, createTarget } from '~/core/index.js'
import { nonNullable } from '~/internal/array.js'
import { getDrizzleForeignKeys, getDrizzleTableName, SQD_PRIMARY_COLS } from './consts.js'
import { PostgresState, StateOptions } from './postgres-state.js'
import { generateTriggerSQL, orderTablesForDelete } from './rollback.js'

export type Transaction = PgTransaction<NodePgQueryResultHKT, any, any>

class DrizzleTracker {
  #knownTables = new Map<Table, boolean>()

  add(table: Table) {
    if (this.#knownTables.has(table)) return

    const from = getDrizzleTableName(table)
    const to = `${from}__snapshots`

    const sql = generateTriggerSQL(from, to, table)

    this.#knownTables.set(table, true)

    return sql
  }

  async cleanup(tx: Transaction, blockNumber: number) {
    for (const table of this.#knownTables.keys()) {
      const from = getDrizzleTableName(table)
      const to = `${from}__snapshots`
      await tx.execute<
        {
          ___sqd__block_number: number
          ___sqd__operation: 'INSERT' | 'UPDATE' | 'DELETE'
        } & Record<string, unknown>
      >(`DELETE FROM "${to}" WHERE "___sqd__block_number" <= ${blockNumber};`)
    }
  }

  async fork(tx: Transaction, cursor: BlockCursor) {
    for (const table of this.#knownTables.keys()) {
      const from = getDrizzleTableName(table)
      const to = `${from}__snapshots`

      const res = await tx.execute<
        {
          ___sqd__block_number: number
          ___sqd__operation: 'INSERT' | 'UPDATE' | 'DELETE'
        } & Record<string, unknown>
      >(`DELETE FROM "${to}" WHERE "___sqd__block_number" > ${cursor.number} RETURNING *`)

      res.rows.sort((a, b) => {
        return b.___sqd__block_number - a.___sqd__block_number
      })

      for (const row of res.rows) {
        const { ___sqd__block_number, ___sqd__operation, ...snapshot } = row
        const primaryCols: PgColumn[] = (table as any)[SQD_PRIMARY_COLS]

        const filter = and(...primaryCols.map((col) => eq(col, snapshot[col.name])))

        switch (___sqd__operation) {
          case 'INSERT':
            await tx.delete(table).where(filter)
            break
          case 'UPDATE':
            await tx.insert(table).values(snapshot).onConflictDoUpdate({
              target: primaryCols,
              set: snapshot,
            })
            break
          case 'DELETE':
            await tx.insert(table).values(snapshot).onConflictDoUpdate({
              target: primaryCols,
              set: snapshot,
            })
            break
        }
      }
    }
  }
}

/**
 * Creates a PostgreSQL target using Drizzle ORM with automatic rollback table creation.
 *
 * @param options - Configuration options
 * @param options.db - Drizzle database instance
 * @param options.tables - Array of Drizzle tables that will be used for data insertion
 * @param options.onStart - Optional callback that runs before processing starts
 * @param options.onData - Callback that processes each batch of data within a transaction
 * @returns Target implementation that can be used with pipe()
 * @example
 * ```ts
 * createDrizzleTarget({
 *   db: drizzle('postgresql://...'),
 *   tables: [myTable],
 *   onData: async ({tx, data}) => {
 *     await tx.insert(myTable).values(data)
 *   }
 * })
 * ```
 */
export function createDrizzleTarget<T>({
  db,
  tables,
  onStart,
  onData,
  onBeforeRollback,
  onAfterRollback,
  settings,
}: {
  db: NodePgDatabase
  settings?: {
    state?: StateOptions
  }
  tables: Table[]
  onStart?: (ctx: { db: NodePgDatabase }) => Promise<unknown>
  onData: (ctx: { tx: Transaction; data: T; ctx: Ctx }) => Promise<unknown>
  onBeforeRollback?: (ctx: { tx: Transaction; cursor: BlockCursor }) => Promise<unknown> | unknown
  onAfterRollback?: (ctx: { tx: Transaction; cursor: BlockCursor }) => Promise<unknown> | unknown
}) {
  const tracker = new DrizzleTracker()
  const client = (db as any).$client
  if (!client) {
    throw new Error('Drizzle client not found on the provided database instance')
  }

  const state = new PostgresState(client, settings?.state)
  const sortedTables = orderTablesForDelete(tables)

  return createTarget<T>({
    write: async ({ read, ctx }) => {
      const cursor = await state.getCursor()

      await onStart?.({ db })
      const triggers = sortedTables.map((table) => tracker.add(table)).filter(nonNullable)

      await db.transaction(async (tx) => {
        await Promise.all(triggers.map((trigger) => tx.execute(trigger)))
      })

      for await (const { data, ctx: batchCtx } of read(cursor)) {
        await db.transaction(async (tx) => {
          const hasUnfinalizedBlocks = batchCtx.state.rollbackChain.length > 0 ? 'true' : 'false'

          /*
           * Enable snapshotting for this transaction
           *
           * We set the block number to the current batch's block number
           * so that any changes made during this transaction can be
           * rolled back to this point if needed.
           */
          await tx.execute(`
            SET LOCAL sqd.snapshot_enabled = ${hasUnfinalizedBlocks};
            SET LOCAL sqd.snapshot_block_number = ${batchCtx.state.current.number};
          `)

          await ctx.profiler.measure('db data handler', async (profiler) => {
            await onData({
              tx,
              data,
              ctx: {
                logger: ctx.logger,
                profiler,
              },
            })
          })

          await batchCtx.profiler.measure('db state save', async (span) => {
            const { safeBlockNumber } = await state.saveCursor(batchCtx)
            if (safeBlockNumber <= 0) return

            ctx.logger.debug(`Safe block number updated to ${safeBlockNumber}`)

            await span.measure('cleanup snapshots', () => {
              return tracker.cleanup(tx, safeBlockNumber)
            })
          })
        })
      }
    },
    fork: async (previousBlocks) => {
      const cursor = await state.fork(previousBlocks)
      if (!cursor) return cursor

      await db.transaction(async (tx) => {
        await onBeforeRollback?.({ tx, cursor })
        await tracker.fork(tx, cursor)
        await onAfterRollback?.({ tx, cursor })
      })

      return cursor
    },
  })
}

/**
 * This limit is derived from the maximum value of a signed 16-bit integer, which is 32,767.
 */
const PG_DRIVER_MAX_PARAMETERS = 32_767

/**
 * Splits an array of records into smaller chunks based on PostgreSQL parameter limits.
 * This is necessary because PostgreSQL has a maximum number of parameters (32767) that can be used in a single query.
 *
 * @param data - Array of records to be split into chunks
 * @param size - Optional custom chunk size. If not provided or exceeds max-allowed size, will use calculated max size
 * @returns Generator yielding chunks of the original array
 * @example
 * ```ts
 * const records = [{id: 1, name: 'a'}, {id: 2, name: 'b'}]
 * for (const chunk of chunk(records)) {
 *   await db.insert(table).values(chunk)
 * }
 * ```
 */
export function* chunk<T>(data: readonly T[], size?: number) {
  // Calculate how many parameters each record will use in the query
  const parametersPerRecord = data[0] ? Object.keys(data[0]).length : 1
  // Calculate maximum chunk size based on Postgres parameter limit
  const maxSize = Math.floor(PG_DRIVER_MAX_PARAMETERS / parametersPerRecord)

  if (!size || size > maxSize) {
    size = maxSize
  }

  for (let i = 0; i < data.length; i += size) {
    yield data.slice(i, i + size)
  }
}
