import type { ClickHouseClient } from '@clickhouse/client'

import { BlockCursor, Ctx, createTarget, Logger } from '~/core'
import { ClickhouseState } from './clickhouse-state'
import { ClickhouseStore } from './clickhouse-store'

const table = (table: string) => `
CREATE TABLE IF NOT EXISTS ${table}
(
    id               String COMMENT 'Stream identifier to differentiate multiple logical streams',
    latest           String COMMENT 'Latest offset (usually corresponds to the most recent known block)',
    initial          String COMMENT 'The first offset from which this stream started tracking',
    finalized_head   String COMMENT 'The finalized hed',
    chain_continuity String COMMENT 'JSON-encoded list of block references starting from the finalized block and including all unfinalized blocks',
    timestamp        DateTime(3) COMMENT 'Timestamp of the record, in milliseconds with 3 decimal precision',
    sign             Int8 COMMENT 'Marker used by CollapsingMergeTree to distinguish insertions (+1) and deletions (-1)'
) ENGINE = CollapsingMergeTree(sign)
  ORDER BY (timestamp, id)
`

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
  onStart?: (batch: { store: ClickhouseStore; logger: Logger }) => unknown | Promise<unknown>
  onData: (batch: { store: ClickhouseStore; data: T; ctx: Ctx }) => unknown | Promise<unknown>
  onRollback?: (batch: {
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
