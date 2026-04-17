import { createClient } from '@clickhouse/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * PC-9 empirical validation: is `INSERT INTO t (cols, sign) SELECT cols, -1 FROM t FINAL WHERE <pred>`
 * idempotent on CollapsingMergeTree once previous tombstones are in place?
 *
 * Skipped by default. Run explicitly with `RUN_PC9_MATRIX=1 pnpm vitest run src/targets/clickhouse/__experiments__/insert-select-final-idempotency.test.ts`
 * against each ClickHouse server version in the PC-9 matrix. Record every
 * `{ch_version, async_insert, merges_state, second_run_inserted_rows}` tuple
 * in `.agent-dev/2026-04-16-ch-rollback-storm/pc9-matrix.md`.
 */

const runPc9 = process.env['RUN_PC9_MATRIX'] === '1'
const describeIfEnabled = runPc9 ? describe : describe.skip

const url = process.env['TEST_CLICKHOUSE_URL'] || 'http://localhost:10123'
const username = process.env['TEST_CLICKHOUSE_USERNAME'] || 'default'
const password = process.env['TEST_CLICKHOUSE_PASSWORD'] || 'default'

const ROW_COUNT = 1_000_000
const PARTITION_PREDICATE = 'pipe_id = {pipeId:String}'

type Matrix = { asyncInsert: 0 | 1; mergesState: 'on' | 'stop'; withMv: boolean }

const matrix: Matrix[] = [
  { asyncInsert: 0, mergesState: 'on', withMv: false },
  { asyncInsert: 1, mergesState: 'on', withMv: false },
  { asyncInsert: 0, mergesState: 'stop', withMv: false },
  { asyncInsert: 1, mergesState: 'stop', withMv: false },
  { asyncInsert: 0, mergesState: 'on', withMv: true },
  { asyncInsert: 1, mergesState: 'on', withMv: true },
]

describeIfEnabled('PC-9 INSERT SELECT FINAL idempotency matrix', () => {
  const client = createClient({ url, username, password })

  async function resetTables(withMv: boolean) {
    await client.command({ query: 'DROP TABLE IF EXISTS t_mv_target SYNC' })
    await client.command({ query: 'DROP TABLE IF EXISTS t_mv SYNC' })
    await client.command({ query: 'DROP TABLE IF EXISTS t SYNC' })

    await client.command({
      query: `
        CREATE TABLE t (
          pipe_id String,
          block_number UInt64,
          payload String,
          sign Int8
        ) ENGINE = CollapsingMergeTree(sign)
        ORDER BY (pipe_id, block_number)
      `,
    })

    if (withMv) {
      await client.command({
        query: `
          CREATE TABLE t_mv_target (
            pipe_id String,
            total_blocks AggregateFunction(sum, Int64)
          ) ENGINE = AggregatingMergeTree()
          ORDER BY pipe_id
        `,
      })
      await client.command({
        query: `
          CREATE MATERIALIZED VIEW t_mv TO t_mv_target AS
          SELECT pipe_id, sumState(toInt64(sign)) AS total_blocks
          FROM t
          GROUP BY pipe_id
        `,
      })
    }
  }

  async function seedRows() {
    await client.command({
      query: `
        INSERT INTO t (pipe_id, block_number, payload, sign)
        SELECT 'p1', number, concat('x', toString(number)), 1
        FROM numbers(${ROW_COUNT})
      `,
    })
  }

  async function countPhysicalRows(): Promise<number> {
    const res = await client.query({
      query: 'SELECT count() AS c FROM t',
      format: 'JSONEachRow',
    })
    const [row] = await res.json<{ c: string }>()
    return Number(row?.c ?? 0)
  }

  async function runRollback(asyncInsert: 0 | 1): Promise<number> {
    const before = await countPhysicalRows()
    await client.command({
      query: `
        INSERT INTO t (pipe_id, block_number, payload, sign)
        SELECT pipe_id, block_number, payload, -1 AS sign
        FROM t FINAL
        WHERE ${PARTITION_PREDICATE}
      `,
      query_params: { pipeId: 'p1' },
      clickhouse_settings: {
        async_insert: asyncInsert,
        wait_for_async_insert: 1,
      },
    })
    const after = await countPhysicalRows()
    return after - before
  }

  async function mvTargetSum(): Promise<number | null> {
    try {
      const res = await client.query({
        query: `SELECT sumMerge(total_blocks) AS s FROM t_mv_target WHERE pipe_id = 'p1'`,
        format: 'JSONEachRow',
      })
      const [row] = await res.json<{ s: string }>()
      return Number(row?.s ?? 0)
    } catch {
      return null
    }
  }

  beforeAll(async () => {
    const res = await client.query({ query: 'SELECT version() AS v', format: 'JSONEachRow' })
    const [{ v }] = await res.json<{ v: string }>()
    // biome-ignore lint/suspicious/noConsole: matrix output
    console.log(`[PC-9] ClickHouse version: ${v}`)
  })

  afterAll(async () => {
    await client.close()
  })

  for (const cell of matrix) {
    it(`${cell.mergesState === 'stop' ? 'STOP MERGES' : 'MERGES ON'} / async_insert=${cell.asyncInsert} / ${cell.withMv ? 'with MV' : 'no MV'}`, async () => {
      await resetTables(cell.withMv)
      await seedRows()

      if (cell.mergesState === 'stop') {
        await client.command({ query: 'SYSTEM STOP MERGES t' })
      }

      const firstRun = await runRollback(cell.asyncInsert)
      const secondRun = await runRollback(cell.asyncInsert)

      if (cell.mergesState === 'stop') {
        await client.command({ query: 'SYSTEM START MERGES t' })
      }

      const mvFirst = cell.withMv ? await mvTargetSum() : null
      // biome-ignore lint/suspicious/noConsole: matrix output
      console.log(
        `[PC-9] cell=${JSON.stringify(cell)} firstRunInserted=${firstRun} secondRunInserted=${secondRun} mvFirst=${mvFirst}`,
      )

      // The first run must produce ROW_COUNT tombstones; the second must produce zero.
      // Any non-zero second-run count flips the Phase-0 decision to branch (b) (temp-table fallback).
      expect(firstRun).toBe(ROW_COUNT)
      expect(secondRun).toBe(0)

      if (cell.withMv) {
        const mvSecond = await mvTargetSum()
        expect(mvFirst).toBe(0)
        expect(mvSecond).toBe(0)
      }
    }, 120_000)
  }
})
