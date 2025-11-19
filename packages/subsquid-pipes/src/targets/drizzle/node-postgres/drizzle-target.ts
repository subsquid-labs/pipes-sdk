import { Table } from 'drizzle-orm'
import { NodePgDatabase } from 'drizzle-orm/node-postgres/driver'
import { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres/session'
import { PgTransaction } from 'drizzle-orm/pg-core'
import type { PgTransactionConfig } from 'drizzle-orm/pg-core/session'

import { BlockCursor, Ctx, createTarget } from '~/core/index.js'
import { nonNullable } from '~/internal/array.js'
import { doWithRetry } from '~/internal/function.js'
import { DrizzleTracker } from './drizzle-tracker.js'
import { PostgresState, StateOptions } from './postgres-state.js'
import { orderTablesForDelete } from './rollback.js'

export type Transaction = PgTransaction<NodePgQueryResultHKT, any, any>

/**
 * Creates a PostgreSQL target using Drizzle ORM with automatic rollback table creation.
 *
 * @param options - Configuration options
 * @param options.db - Drizzle database instance
 * @param options.tables - Array of Drizzle tables that will be used for tracking rollbacks
 * @param options.onStart - Optional callback that runs before processing starts
 * @param options.onData - Callback that processes each batch of data within a transaction
 * @param options.onBeforeRollback - Optional callback that runs before a rollback is performed
 * @param options.onAfterRollback - Optional callback that runs after a rollback is performed
 * @param options.settings - Optional settings for state management and transaction configuration
 * @returns Target implementation that can be used with pipe()
 * @example
 * ```ts
 * drizzleTarget({
 *   db: drizzle('postgresql://...'),
 *   tables: [myTable],
 *   onData: async ({tx, data}) => {
 *     await tx.insert(myTable).values(data)
 *   }
 * })
 * ```
 */
export function drizzleTarget<T>({
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
    transaction?: {
      isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
    }
  }
  tables: Table[] | Record<string, Table>
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
  const sortedTables = orderTablesForDelete(Array.isArray(tables) ? tables : Object.values(tables))

  return createTarget<T>({
    write: async ({ read, logger }) => {
      const cursor = await state.getCursor()

      await onStart?.({ db })
      const triggers = sortedTables.map((table) => tracker.add(table)).filter(nonNullable)

      const config: PgTransactionConfig = {
        isolationLevel: settings?.transaction?.isolationLevel || 'serializable',
      }

      await db.transaction(async (tx) => {
        await Promise.all(triggers.map((trigger) => tx.execute(trigger)))
      }, config)

      for await (const { data, ctx } of read(cursor)) {
        await doWithRetry(
          () =>
            db.transaction(async (tx) => {
              const snapshotEnabled =
                ctx.head.finalized?.number && ctx.state.current.number >= ctx.head.finalized.number ? 'true' : 'false'

              /*
               * Enable snapshotting for this transaction
               *
               * We set the block number to the current batch's block number
               * so that any changes made during this transaction can be
               * rolled back to this point if needed.
               */
              await tx.execute(`
                SET LOCAL sqd.snapshot_enabled = ${snapshotEnabled};
                SET LOCAL sqd.snapshot_block_number = ${ctx.state.current.number};
              `)

              await ctx.profiler.measure('db data handler', async (profiler) => {
                await onData({
                  tx: tracker.wrapTransaction(tx),
                  data,
                  ctx: {
                    logger,
                    profiler,
                  },
                })
              })

              await ctx.profiler.measure('db state save', async (span) => {
                const { safeBlockNumber } = await state.saveCursor(ctx)
                if (safeBlockNumber <= 0) return

                logger.debug(`Safe block number updated to ${safeBlockNumber}`)

                await span.measure('cleanup snapshots', () => {
                  return tracker.cleanup(tx, safeBlockNumber)
                })
              })
            }, config),
          {
            title: 'batch insert transaction',
            retries: 3,
            delayMs: 1000,
          },
        )
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
