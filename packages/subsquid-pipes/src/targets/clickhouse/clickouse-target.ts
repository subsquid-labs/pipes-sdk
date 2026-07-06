import type { ClickHouseClient } from '@clickhouse/client'

import { BlockCursor, Ctx, Logger, createTarget } from '~/core/index.js'

import { ClickhouseState } from './clickhouse-state.js'
import { ClickhouseStore } from './clickhouse-store.js'

/**
 * Configuration options for ClickhouseState.
 */
export type Settings = {
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
   *
   * When left to default, a cursor written by an older SDK under the legacy static
   * `"stream"` id is migrated to the pipe's id automatically on first resume. If several
   * pipes shared one offset table under that legacy default, only one of them owned the
   * surviving cursor — pin an explicit id per pipe before upgrading such setups.
   */
  id?: string

  /**
   * Maximum number of rows to retain per unique stream id in the offset table.
   * Older rows beyond this count will be removed.
   * Default is 10,000.
   */
  maxRows?: number
}

export function clickhouseTarget<T>({
  client,
  onStart,
  onData,
  onRollback,
  settings = {},
}: {
  client: ClickHouseClient
  settings?: Settings
  onStart?: (ctx: { store: ClickhouseStore; logger: Logger }) => unknown | Promise<unknown>
  onData: (ctx: { store: ClickhouseStore; data: T; ctx: Ctx }) => unknown | Promise<unknown>
  /**
   * Called when previously written blocks must be removed — on a blockchain fork or an
   * offset check at startup. The typical implementation calls `store.removeAllRows` with
   * `where: 'block_number > {latest:UInt32}'` and `params: { latest: safeCursor.number }`.
   *
   * On CollapsingMergeTree / VersionedCollapsingMergeTree tables (or their Replicated
   * variants) with a `sign` column, `store.removeAllRows` removes rows by inserting
   * cancel rows (sign = -1) — the only removal mechanism that propagates through
   * materialized views. On any other engine it falls back to a lightweight `DELETE` with
   * a warning: the table itself is cleaned, but materialized views built on it keep the
   * removed data. It also auto-creates a minmax skip index on `block_number` so the
   * rollback stays fast on large tables; call `store.ensureRollbackIndex({ table })` in
   * `onStart` to set the index up eagerly.
   */
  onRollback?: (ctx: {
    type: 'offset_check' | 'blockchain_fork'
    store: ClickhouseStore
    safeCursor: BlockCursor

    /** @deprecated Use `safeCursor` from state instead */
    cursor: BlockCursor
  }) => unknown | Promise<unknown>
}) {
  // TODO Can we generate row ID based on query?

  const store = new ClickhouseStore(client)
  const state = new ClickhouseState(store, settings)

  return createTarget<T>({
    write: async ({ read, logger, id }) => {
      // Key the cursor by the pipe's source id (unless an explicit settings.id was given), so
      // progress is isolated per pipe. Must run before getCursor so read and write agree.
      state.bindCursorKey(id, logger)
      store.bindLogger(logger)

      await onStart?.({ store, logger })
      const cursor = await state.getCursor()

      if (cursor) {
        await onRollback?.({
          type: 'offset_check',
          store,
          cursor: cursor.latest,
          safeCursor: cursor.latest,
        })
      }

      for await (const { data, ctx } of read(cursor)) {
        const target = ctx.profiler.start({ name: 'clickhouse', labels: 'db' })

        try {
          await target.measure('data handler', async (profiler) => {
            await onData({
              store,
              data: data,
              ctx: {
                logger,
                profiler,
              },
            })
          })

          await state.saveCursor(ctx, target)
        } finally {
          target.end()
        }
      }

      await store.close()
    },
    fork: async (previousBlocks) => {
      const cursor = await state.fork(previousBlocks)
      if (!cursor) return cursor

      await onRollback?.({
        type: 'blockchain_fork',
        store,
        cursor,
        safeCursor: cursor,
      })
      return cursor
    },
  })
}

/**
 *  @deprecated use `clickhouseTarget` instead
 */
export const createClickhouseTarget = clickhouseTarget
