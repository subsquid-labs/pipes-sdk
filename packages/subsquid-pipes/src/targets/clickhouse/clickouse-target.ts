import type { ClickHouseClient } from '@clickhouse/client'

import { BlockCursor, Ctx, Logger, createTarget } from '~/core/index.js'

import {
  CheckpointTableEnsurer,
  ColumnIntrospector,
  type RollbackReason,
  type RollbackResult,
  type RollbackSettings,
  getRollbackSemaphore,
  resolveRollbackSettings,
  runManagedRollback,
  validateRollbackTargets,
} from './clickhouse-rollback.js'
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

  /**
   * Declarative rollback configuration (SDKTL-52). When `targets` is declared,
   * the SDK runs a managed rollback path for each target on `offset_check` and
   * `blockchain_fork`, and the user's `onRollback` hook receives a
   * `skippedTables` argument listing the tables the SDK already handled.
   */
  rollback?: RollbackSettings
}

export type RollbackHookContext = {
  type: 'offset_check' | 'blockchain_fork'
  store: ClickhouseStore
  safeCursor: BlockCursor
  /** Tables the SDK's managed rollback path already tombstoned. User hooks should skip them. */
  skippedTables: string[]

  /** @deprecated Use `safeCursor` from state instead */
  cursor: BlockCursor
}

/**
 * Build a ClickHouse write target for the pipe.
 *
 * When `settings.rollback.targets` is declared, the SDK runs a managed
 * rollback path for each target on both `offset_check` (init-time, on resume)
 * and `blockchain_fork`. Targets that also declare `cursorColumn` are handled
 * via the chunked + resumable path backed by a `_sqd_rollback_checkpoint`
 * table; targets without `cursorColumn` fall back to a single monolithic
 * `INSERT INTO t (cols, sign) SELECT cols, -1 FROM t FINAL WHERE <scope>`.
 *
 * The managed path tombstones via the CollapsingMergeTree `sign` column.
 * Tables listed in `targets` are passed to the optional `onRollback` hook via
 * the `skippedTables` argument so user code can skip them.
 *
 * Every rollback invocation emits structured log events on the target's
 * logger: `rollback.start`, optional `rollback.chunk` per chunk, and
 * `rollback.end` discriminated on `{ short_circuit | monolithic | chunked }`.
 * See `RollbackLogEvent` for the full event union.
 */
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
  onRollback?: (ctx: RollbackHookContext) => unknown | Promise<unknown>
}) {
  const store = new ClickhouseStore(client)
  const state = new ClickhouseState(store, settings)
  const rollbackSettings = resolveRollbackSettings(settings.rollback)
  const rollbackTargetsDeclared = rollbackSettings.targets.length > 0
  const introspector = new ColumnIntrospector(store)
  const checkpointEnsurer = new CheckpointTableEnsurer()
  const chunkedConfigured = rollbackSettings.targets.some((t) => t.cursorColumn)
  let capturedLogger: Logger | undefined

  const runManaged = async (
    reason: RollbackReason,
    safeCursor: BlockCursor,
    logger: Logger | undefined,
    syncCurrent?: BlockCursor,
  ): Promise<string[]> => {
    if (!rollbackTargetsDeclared) return []
    const semaphore = getRollbackSemaphore({
      client,
      db: state.options.database,
      concurrency: rollbackSettings.concurrency,
      baseMs: rollbackSettings.retryBackoff.baseMs,
      jitter: rollbackSettings.retryBackoff.jitter,
    })
    const { skippedTables } = await runManagedRollback(rollbackSettings.targets, reason, safeCursor, {
      store,
      introspector,
      defaultDb: state.options.database,
      logger,
      syncCurrent,
      chunked: chunkedConfigured
        ? {
            ensurer: checkpointEnsurer,
            stream: state.options.id,
            chunkSize: rollbackSettings.chunkSize,
            checkpointTable: rollbackSettings.checkpointTable,
          }
        : undefined,
      semaphore,
    })
    return skippedTables
  }

  return createTarget<T>({
    write: async ({ read, logger }) => {
      capturedLogger = logger
      await onStart?.({ store, logger })

      if (rollbackTargetsDeclared) {
        await validateRollbackTargets({
          store,
          defaultDb: state.options.database,
          targets: rollbackSettings.targets,
        })
      }

      const cursor = await state.getCursor()

      if (cursor) {
        const skippedTables = await runManaged('offset_check', cursor, logger)
        await onRollback?.({
          type: 'offset_check',
          store,
          cursor,
          safeCursor: cursor,
          skippedTables,
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
      // R-B freeze: capture the pre-fork in-memory cursor BEFORE state.fork()
      // touches anything. Phase 3's chunked path consumes this value as
      // `syncCurrent` for max_cursor derivation. Phase 1 threads it but does
      // not yet use it.
      const syncCurrent = state.snapshotCurrent()
      const cursor = await state.fork(previousBlocks)
      if (!cursor) return cursor

      const skippedTables = await runManaged('blockchain_fork', cursor, capturedLogger, syncCurrent)
      await onRollback?.({
        type: 'blockchain_fork',
        store,
        cursor,
        safeCursor: cursor,
        skippedTables,
      })
      return cursor
    },
  })
}

/**
 *  @deprecated use `clickhouseTarget` instead
 */
export const createClickhouseTarget = clickhouseTarget

export type {
  RollbackChunkEvent,
  RollbackEndEvent,
  RollbackLogEvent,
  RollbackReason,
  RollbackResult,
  RollbackSettings,
  RollbackStartEvent,
  RollbackTarget,
} from './clickhouse-rollback.js'
