import type { BigQuery } from '@google-cloud/bigquery'

import { type BlockCursor, type Ctx, type Logger, createTarget } from '~/core/index.js'

import { BigQueryStore } from './bigquery-store.js'
import { BigQuerySession, terminateDanglingSession } from './bigquery-tx-session.js'
import { buildSaveCursorSql, createStateTable, getCursor } from './bigquery-tx-state.js'

export type BigQueryTransactionalTargetSettings = {
  /**
   * Name of the BQ table used to persist the stream cursor.
   * Defaults to `'pipe_sync'`.
   */
  stateTable?: string

  /**
   * Stream identifier, used as the cursor key inside `stateTable`.
   * Defaults to `'stream'`.
   */
  id?: string

  /**
   * Path to the file where the active session ID is persisted.
   * On startup, if this file exists its session is terminated before any work
   * begins, cleaning up crashes that left a dangling BQ session.
   * Defaults to `'.bigquery-session'` (relative to `process.cwd()`).
   */
  sessionFile?: string
}

/**
 * A Pipes SDK target that writes each batch inside a BigQuery session
 * transaction.  Both the user data and the cursor update are committed
 * atomically — a crash mid-batch leaves no partial data.
 *
 * **Blockchain forks are not supported.**  If the upstream source emits a
 * fork signal this target throws an uncaught error.  Use a finalized-only
 * data source to avoid this.
 */
export function bigqueryTransactionalTarget<T>({
  bigquery,
  dataset,
  settings = {},
  onStart,
  onData,
  onRollback,
}: {
  bigquery: BigQuery
  dataset: string
  settings?: BigQueryTransactionalTargetSettings
  /** Called once on startup. Use it to run DDL (CREATE TABLE IF NOT EXISTS). */
  onStart?: (ctx: { store: BigQueryStore; logger: Logger }) => unknown | Promise<unknown>
  /** Called for every batch.  All writes must go through `session.query()`. */
  onData: (ctx: {
    session: BigQuerySession
    data: T
    ctx: Ctx
  }) => unknown | Promise<unknown>
  /**
   * Called on startup when a saved cursor is found — a safety net for any
   * external state that needs cleanup.  Because transactions guarantee
   * cursor+data atomicity, this typically does nothing for pure BQ writes.
   */
  onRollback?: (ctx: {
    type: 'offset_check'
    store: BigQueryStore
    safeCursor: BlockCursor
  }) => unknown | Promise<unknown>
}) {
  const stateTable = settings.stateTable ?? 'pipe_sync'
  const id = settings.id ?? 'stream'
  const sessionFile = settings.sessionFile ?? '.bigquery-session'

  const store = new BigQueryStore(bigquery, dataset)

  return createTarget<T>({
    write: async ({ read, logger }) => {
      await terminateDanglingSession(bigquery, sessionFile)

      await createStateTable(bigquery, dataset, stateTable)
      await onStart?.({ store, logger })

      let cursor = await getCursor(bigquery, dataset, stateTable, id)

      if (cursor) {
        await onRollback?.({ type: 'offset_check', store, safeCursor: cursor })
      }

      for await (const { data, ctx } of read(cursor)) {
        let session: BigQuerySession | undefined

        try {
          session = await BigQuerySession.create(bigquery, sessionFile)

          await ctx.profiler.measure('db data handler', async (profiler) => {
            await onData({ session: session!, data, ctx: { logger, profiler } })
          })

          await ctx.profiler.measure('db state save', async () => {
            await session!.query(
              buildSaveCursorSql(dataset, stateTable, id, ctx.stream.state.current),
            )
            await session!.commit()
            session = undefined
          })

          cursor = ctx.stream.state.current
        } catch (e) {
          if (session !== undefined) {
            await session.rollback().catch(() => {})
          }
          throw e
        }
      }
    },

    fork: async () => {
      throw new Error(
        'bigqueryTransactionalTarget does not support blockchain forks. ' +
          'Run on a finalized-only data source to avoid this error.',
      )
    },
  })
}
