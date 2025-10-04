import type { ClickHouseClient } from '@clickhouse/client'

import { BlockCursor, Ctx, createTarget, Logger } from '~/core/index.js'
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

export function createClickhouseTarget<T>({
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
  onRollback?: (ctx: {
    type: 'offset_check' | 'blockchain_fork'
    store: ClickhouseStore
    cursor: BlockCursor
  }) => unknown | Promise<unknown>
}) {
  // TODO Can we generate row ID based on query?

  const store = new ClickhouseStore(client)
  const state = new ClickhouseState(store, settings)

  return createTarget<T>({
    write: async ({ read, ctx }) => {
      await onStart?.({ store, logger: ctx.logger })
      const cursor = await state.getCursor()

      if (cursor) {
        await onRollback?.({ type: 'offset_check', store, cursor: cursor })
      }

      for await (const { data, ctx: batchCtx } of read(cursor)) {
        const userSpan = ctx.profiler.start('data handler')
        await onData({
          store,
          data: data,
          ctx: {
            logger: ctx.logger,
            profiler: userSpan,
          },
        })
        userSpan.end()

        const cursorSpan = batchCtx.profiler.start('clickhouse cursor save')
        await state.saveCursor(batchCtx)
        cursorSpan.end()
      }

      await store.close()
    },
    fork: async (previousBlocks) => {
      return state.fork(previousBlocks)
    },
  })
}
