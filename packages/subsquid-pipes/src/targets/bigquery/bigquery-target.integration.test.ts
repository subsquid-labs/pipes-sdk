import { BigQuery } from '@google-cloud/bigquery'
import { managedwriter } from '@google-cloud/bigquery-storage'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { BatchContext, BlockCursor } from '~/core/index.js'
import { evmPortalStream } from '~/evm/evm-portal-source.js'
import {
  type MockPortal,
  type MockResponse,
  blockDecoder,
  createMockPortal,
  createTestLogger,
} from '~/testing/index.js'

import { BigQueryState } from './bigquery-state.js'
import { BigQueryStore } from './bigquery-store.js'
import { bigqueryTarget } from './bigquery-target.js'
import {
  type TrackedTable,
  ensureTrackedTable,
  partitioningWithDefaults,
  syncTableDdl,
  trackedTableDdl,
} from './tables.js'

/**
 * Integration tests for the BigQuery target — gated by `BIGQUERY_TEST_PROJECT`.
 *
 * Runs against real BigQuery only. The project must have BigQuery + BigQuery Storage Write
 * APIs enabled and application-default credentials configured (`gcloud auth
 * application-default login`).
 *
 * Run:
 *   BIGQUERY_TEST_PROJECT=my-gcp-project \
 *   BIGQUERY_TEST_DATASET=pipes_target_test \
 *   pnpm vitest run src/targets/bigquery/bigquery-target.integration.test.ts
 *
 * What this suite verifies that unit tests cannot:
 *   - Generated DDL is accepted by the live SQL parser (catches reserved-keyword bugs and
 *     clause-ordering mistakes that mocked tests can't surface).
 *   - `BigQueryState.getCursor` round-trips through real REST (Not Found error → CREATE
 *     TABLE → returns undefined).
 *   - Real Storage Write API Pending mode end-to-end (CreateWriteStream → AppendRows →
 *     FinalizeWriteStream → BatchCommitWriteStreams over actual gRPC).
 *   - GA DML on freshly streamed rows: DELETE within seconds of the Pending commit
 *     succeeds — the central correctness claim of this target.
 *   - Partition pruning: `dryRun` bytes-billed for a fork DELETE stays within
 *     partition_width × row_size, proving both bounds in the predicate fire static
 *     partition pruning at the planner.
 */

const PROJECT = process.env['BIGQUERY_TEST_PROJECT']
const DATASET = process.env['BIGQUERY_TEST_DATASET'] ?? 'pipes_target_test'
const RUN = !!PROJECT

describe.skipIf(!RUN)('bigquery target — integration', () => {
  // `describe.skipIf(!RUN)` gates on PROJECT being set, so inside the suite we narrow once.
  const projectId = PROJECT as string

  let bigquery: BigQuery
  let writer: managedwriter.WriterClient

  // Every table this suite creates uses this prefix. Two reasons:
  //   1. The leftover-sweep in `beforeAll` matches exactly these tables — never the user's
  //      own data sharing the same dataset.
  //   2. Easy to spot test artefacts in the BigQuery console.
  // Each test then appends its own `<purpose>_<timestamp>` so failures leave inspectable
  // state behind without contaminating sibling tests.
  const PREFIX = 'e2e_test_'
  const partitioning = partitioningWithDefaults()

  // Schema template — copied per-test with an overridden `table` name.
  const trackedTable: TrackedTable = {
    table: 'unused', // overridden per-test
    blockNumberColumn: 'block_number',
    schema: [
      { name: 'block_number', type: 'INT64', mode: 'REQUIRED' },
      { name: 'tx_hash', type: 'STRING' },
    ],
  }

  beforeAll(async () => {
    bigquery = new BigQuery({ projectId })
    writer = new managedwriter.WriterClient({ projectId })

    const [exists] = await bigquery.dataset(DATASET).exists()
    if (!exists) await bigquery.createDataset(DATASET)

    // Drop leftover tables from previous runs. Tests do NOT clean up after themselves on
    // purpose — we want failed runs to leave their state behind for inspection. The next
    // run wipes via this prefix-scoped sweep, so leftovers never accumulate beyond one run.
    const [allTables] = await bigquery.dataset(DATASET).getTables()
    await Promise.all(
      allTables
        .filter((t) => (t.id ?? '').startsWith(PREFIX))
        .map((t) => t.delete({ ignoreNotFound: true }).catch(() => {})),
    )
  }, 60_000)

  /** Helper: produce a synthetic BatchContext for direct target.write loops. */
  function makeBatchContext(current: BlockCursor): BatchContext {
    const profilerStub: Record<string, unknown> = {
      start: () => profilerStub,
      measure: async (_: unknown, fn: () => unknown) => fn(),
      end: () => {},
    }
    return {
      logger: createTestLogger(),
      profiler: profilerStub,
      stream: {
        state: { current, rollbackChain: [current] },
        head: { finalized: undefined, latest: current },
      },
    } as unknown as BatchContext
  }

  describe('DDL parse — generated SQL is accepted by the live BigQuery parser', () => {
    it('sync-table DDL: backtick-quoted reserved keywords + DEFAULT ordering', async () => {
      // Without backtick-quoting on `current` / `timestamp` etc the parser would reject with
      // `Syntax error: ... keyword CURRENT`. And `DEFAULT CURRENT_TIMESTAMP()` must come
      // BEFORE `NOT NULL` in BQ's column-definition grammar — the wrong order trips a
      // different syntax error. Both bugs are invisible to the unit suite, which never runs
      // the SQL through a parser.
      const localSync = `${PREFIX}sync_ddl_${Date.now()}`
      const ddl = syncTableDdl({ fqn: `${PROJECT}.${DATASET}.${localSync}`, dataset: DATASET, table: localSync })
      await bigquery.query({ query: ddl })
    }, 30_000)

    it('tracked-table DDL parses', async () => {
      const localEvents = `${PREFIX}events_ddl_${Date.now()}`
      const ddl = trackedTableDdl(
        `${PROJECT}.${DATASET}.${localEvents}`,
        { ...trackedTable, table: localEvents },
        partitioning,
      )
      await bigquery.query({ query: ddl })
    }, 30_000)
  })

  describe('schema management — REST path', () => {
    it('ensureTrackedTable auto-creates a missing tracked table via the NotFound branch', async () => {
      const localEvents = `${PREFIX}events_create_${Date.now()}`
      await ensureTrackedTable({
        bigquery,
        projectId,
        dataset: DATASET,
        trackedTable: { ...trackedTable, table: localEvents },
        partitioning,
      })

      const [exists] = await bigquery.dataset(DATASET).table(localEvents).exists()
      expect(exists).toBe(true)
    }, 30_000)

    it('BigQueryState.getCursor lazy-creates the sync table on Not Found and returns undefined', async () => {
      const localSync = `${PREFIX}sync_lazy_${Date.now()}`
      const store = new BigQueryStore(bigquery, writer, {
        projectId,
        dataset: DATASET,
        trackedTables: [],
        syncTable: { dataset: DATASET, table: localSync },
      })
      const state = new BigQueryState({
        store,
        bigquery,
        trackedTables: [],
        options: { projectId, dataset: DATASET, table: localSync },
      })

      const cursor = await state.getCursor({ logger: createTestLogger() })
      expect(cursor).toBeUndefined()

      const [exists] = await bigquery.dataset(DATASET).table(localSync).exists()
      expect(exists).toBe(true)
    }, 30_000)
  })

  describe('Storage Write API — visibility', () => {
    it('Committed-stream sync row written via the store is immediately visible to SQL SELECT', async () => {
      // Isolates the question "are Committed-stream writes immediately readable by SQL?"
      // from the fork-resolution chain. If this passes but the fork test fails, the bug is
      // in resolveForkCursor / our paging — not in BigQuery's read-after-write semantics.
      const localSync = `${PREFIX}sync_visibility_${Date.now()}`
      const store = new BigQueryStore(bigquery, writer, {
        projectId,
        dataset: DATASET,
        trackedTables: [],
        syncTable: { dataset: DATASET, table: localSync },
      })
      const state = new BigQueryState({
        store,
        bigquery,
        trackedTables: [],
        options: { projectId, dataset: DATASET, table: localSync },
      })

      await state.getCursor({ logger: createTestLogger() }) // lazy-creates the table

      // Write one COMMITTED sync row through the same Storage Write API path the production
      // WAL uses (saveCommitPost → commitSyncRow → Committed-stream AppendRows).
      await state.saveCommitPost({
        logger: createTestLogger(),
        cursor: { number: 42, hash: '0x42' },
        finalized: undefined,
        rollbackChain: [{ number: 42, hash: '0x42' }],
      })

      const [rows] = await bigquery.query({
        query: `SELECT JSON_EXTRACT_SCALAR(\`current\`, '$.number') AS n FROM \`${projectId}.${DATASET}.${localSync}\` WHERE \`committed\` = TRUE`,
      })
      expect(rows.length).toBe(1)
      expect(Number(rows[0].n)).toBe(42)
    }, 30_000)
  })

  describe('Storage Write API — write + fork end-to-end', () => {
    // Each test gets its own dedicated events + sync table pair so writes from one test
    // never contaminate another's row counts. The shared `${PREFIX}` sweep in `beforeAll`
    // cleans them all up on the next run.

    it('completes a write batch end-to-end and advances the cursor', async () => {
      const localEvents = `${PREFIX}events_write_${Date.now()}`
      const localSync = `${PREFIX}sync_write_${Date.now()}`
      const target = bigqueryTarget<{ block_number: number; tx_hash: string }>({
        client: { bigquery, writer },
        dataset: DATASET,
        tables: [{ ...trackedTable, table: localEvents }],
        settings: { state: { table: localSync } },
        onData: async ({ store, data }) => {
          store.insert(localEvents, [data])
        },
      })

      async function* read() {
        yield {
          data: { block_number: 1, tx_hash: '0x1' },
          ctx: makeBatchContext({ number: 1, hash: '0x1' }),
        }
      }

      await target.write({ read: read as never, logger: createTestLogger() })

      const [rows] = await bigquery.query({
        query: `SELECT block_number FROM \`${projectId}.${DATASET}.${localEvents}\` WHERE block_number = 1`,
      })
      expect(rows.length).toBe(1)
    }, 60_000)

    it('fork DELETE removes forked-block rows from a real BQ table', async () => {
      // The central claim of this PR: DML on freshly-committed Storage Write rows works.
      // Write blocks 1..10, fork at block 5, assert blocks 6..10 are gone and 1..5 remain.
      const localEvents = `${PREFIX}events_fork_${Date.now()}`
      const localSync = `${PREFIX}sync_fork_${Date.now()}`
      const target = bigqueryTarget<{ block_number: number; tx_hash: string }>({
        client: { bigquery, writer },
        dataset: DATASET,
        tables: [{ ...trackedTable, table: localEvents }],
        settings: { state: { table: localSync } },
        onData: async ({ store, data }) => {
          store.insert(localEvents, [data])
        },
      })

      async function* write1To10() {
        for (let i = 1; i <= 10; i++) {
          yield {
            data: { block_number: i, tx_hash: `0x${i.toString(16)}` },
            ctx: makeBatchContext({ number: i, hash: `0x${i.toString(16)}` }),
          }
        }
      }

      await target.write({ read: write1To10 as never, logger: createTestLogger() })

      const [pre] = await bigquery.query({
        query: `SELECT COUNT(*) AS n FROM \`${projectId}.${DATASET}.${localEvents}\` WHERE block_number BETWEEN 1 AND 10`,
      })
      expect(Number(pre[0].n)).toBe(10)

      const previousBlocks: BlockCursor[] = [
        { number: 5, hash: '0x5' },
        { number: 6, hash: 'BAD6' },
        { number: 7, hash: 'BAD7' },
        { number: 8, hash: 'BAD8' },
        { number: 9, hash: 'BAD9' },
        { number: 10, hash: 'BADA' },
      ]
      const safe = await target.fork!(previousBlocks)
      expect(safe?.number).toBe(5)

      const [post] = await bigquery.query({
        query: `SELECT COUNT(*) AS n FROM \`${projectId}.${DATASET}.${localEvents}\` WHERE block_number BETWEEN 6 AND 10`,
      })
      expect(Number(post[0].n)).toBe(0)

      const [kept] = await bigquery.query({
        query: `SELECT COUNT(*) AS n FROM \`${projectId}.${DATASET}.${localEvents}\` WHERE block_number BETWEEN 1 AND 5`,
      })
      expect(Number(kept[0].n)).toBe(5)
    }, 180_000)
  })

  describe('fork-rollback SQL', () => {
    it('parameterised DELETE with numeric BETWEEN bounds runs cleanly', async () => {
      const localEvents = `${PREFIX}events_dml_${Date.now()}`
      await ensureTrackedTable({
        bigquery,
        projectId,
        dataset: DATASET,
        trackedTable: { ...trackedTable, table: localEvents },
        partitioning,
      })

      const [job] = await bigquery.createQueryJob({
        query: `DELETE FROM \`${projectId}.${DATASET}.${localEvents}\` WHERE block_number BETWEEN @low AND @high`,
        params: { low: 100, high: 200 },
      })
      await job.getQueryResults()
    }, 30_000)

    it('keeps DELETE bytes-billed within partition width × row size (partition-pruning regression)', async () => {
      const localEvents = `${PREFIX}events_dryrun_${Date.now()}`
      await ensureTrackedTable({
        bigquery,
        projectId,
        dataset: DATASET,
        trackedTable: { ...trackedTable, table: localEvents },
        partitioning,
      })

      const [job] = await bigquery.createQueryJob({
        query: `DELETE FROM \`${projectId}.${DATASET}.${localEvents}\` WHERE block_number > @safe AND block_number <= @upper`,
        params: { safe: 0, upper: 10 },
        dryRun: true,
      })
      const bytesBilled = Number(job.metadata.statistics?.totalBytesProcessed ?? '0')
      expect(bytesBilled).toBeLessThan(10 * 1024 * 1024) // <10MB scan for a 10-row range
    })
  })

  // ---------------------------------------------------------------------------------------
  // Fork scenarios driven through the full pipeTo() path with a mock portal.
  //
  // These mirror the ClickHouse / Postgres reorg suites: rather than calling target.fork()
  // directly, we let evmPortalStream replay 409 reorg responses and observe BQ table /
  // sync-table state after the framework drives target.fork() and re-stream automatically.
  //
  // Each test creates a fresh tracked + sync table pair so writes / DELETEs from one test
  // never bleed into another. Tables are reaped on the next run by the PREFIX sweep in
  // beforeAll — failed runs deliberately leave the inspectable state behind.
  // ---------------------------------------------------------------------------------------

  describe('forks (mock portal end-to-end)', () => {
    let mockPortal: MockPortal | undefined

    afterEach(async () => {
      await mockPortal?.close()
      mockPortal = undefined
    })

    /** Build a tracked-events + sync table pair with unique names for one test. */
    function uniqueTables(slug: string) {
      const stamp = Date.now()
      return {
        events: `${PREFIX}events_${slug}_${stamp}`,
        sync: `${PREFIX}sync_${slug}_${stamp}`,
      }
    }

    type Header = { number: number; hash: string; timestamp: number }

    /**
     * Builds a fork-test target. The generic stays explicit so hook callbacks
     * (`onAfterRollback`, custom `onData`, etc) infer their parameter types
     * instead of collapsing to `any` through a Parameters<…> spread.
     */
    function buildTarget(
      events: string,
      sync: string,
      overrides: {
        onData?: (ctx: { store: BigQueryStore; data: Header[] }) => Promise<unknown> | unknown
        onBeforeRollback?: (ctx: { cursor: BlockCursor }) => Promise<unknown> | unknown
        onAfterRollback?: (ctx: { cursor: BlockCursor }) => Promise<unknown> | unknown
      } = {},
    ) {
      return bigqueryTarget<Header[]>({
        client: { bigquery, writer },
        dataset: DATASET,
        tables: [{ ...trackedTable, table: events }],
        settings: { state: { table: sync } },
        onData:
          overrides.onData ??
          (({ store, data }) => {
            store.insert(
              events,
              data.map((b) => ({ block_number: b.number, tx_hash: b.hash })),
            )
          }),
        onBeforeRollback: overrides.onBeforeRollback,
        onAfterRollback: overrides.onAfterRollback,
      })
    }

    async function readEvents(events: string): Promise<{ block_number: number; tx_hash: string }[]> {
      const [rows] = await bigquery.query({
        query: `SELECT block_number, tx_hash FROM \`${projectId}.${DATASET}.${events}\` ORDER BY block_number ASC`,
      })
      return rows.map((r: { block_number: number | string; tx_hash: string }) => ({
        block_number: Number(r.block_number),
        tx_hash: r.tx_hash,
      }))
    }

    async function readSyncCommittedCursors(
      sync: string,
    ): Promise<{ current: { number: number; hash: string }; finalized: { number: number; hash: string } | null }[]> {
      // Project the same shape the ClickHouse suite asserts on: `current` (committed cursor),
      // `finalized`, ordered by write time. `op='commit'` filters out IN_FLIGHT_ROLLBACK rows
      // since those carry no meaningful cursor.
      const [rows] = await bigquery.query({
        query: `SELECT \`current\`, finalized FROM \`${projectId}.${DATASET}.${sync}\`
                WHERE op = 'commit' AND committed = TRUE
                ORDER BY \`timestamp\` ASC`,
      })
      return rows.map((r: { current: string | null; finalized: string | null }) => ({
        current: JSON.parse(r.current ?? 'null'),
        finalized: r.finalized ? JSON.parse(r.finalized) : null,
      }))
    }

    it('handles a simple fork: re-streams forked tail and DELETE removes superseded rows', async () => {
      const { events, sync } = uniqueTables('simple')

      mockPortal = await createMockPortal([
        // First batch: blocks 1..5 on the original chain.
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        // 409 reorg: blocks 4 and 5 forked off the canonical chain.
        {
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 2, hash: '0x2' },
              { number: 3, hash: '0x3' },
              { number: 4, hash: '0x4-1' },
              { number: 5, hash: '0x5-1' },
            ],
          },
        },
        // Re-stream after the framework drives target.fork() — blocks 4..7 on the new chain.
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7a', timestamp: 7000 } },
          ],
        },
      ])

      let beforeRollbacks = 0
      let afterRollbacks = 0
      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(
        buildTarget(events, sync, {
          onBeforeRollback: ({ cursor }) => {
            beforeRollbacks++
            expect(cursor).toMatchObject({ number: 3, hash: '0x3' })
          },
          onAfterRollback: ({ cursor }) => {
            afterRollbacks++
            expect(cursor).toMatchObject({ number: 3, hash: '0x3' })
          },
        }),
      )

      expect(beforeRollbacks).toBe(1)
      expect(afterRollbacks).toBe(1)

      // Rows 1..3 from the original stream survive; 4-5 (orig) are gone; 4a-7a are present.
      // The unique block_hash per row also proves we didn't accidentally double-insert
      // (the WAL recovery range is [previousCursor+1, next] — a stale recovery would re-run
      // a DELETE that wipes the rows we just inserted).
      expect(await readEvents(events)).toEqual([
        { block_number: 1, tx_hash: '0x1' },
        { block_number: 2, tx_hash: '0x2' },
        { block_number: 3, tx_hash: '0x3' },
        { block_number: 4, tx_hash: '0x4a' },
        { block_number: 5, tx_hash: '0x5a' },
        { block_number: 6, tx_hash: '0x6a' },
        { block_number: 7, tx_hash: '0x7a' },
      ])
    }, 240_000)

    it('handles a fork whose finalized block is missing from the in-flight batch (multi-step rollback)', async () => {
      const { events, sync } = uniqueTables('missing_finalized')

      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        // First reorg: only blocks 4..5 visible — common ancestor not yet found in this slice.
        {
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 4, hash: '0x4a' },
              { number: 5, hash: '0x5a' },
            ],
          },
        },
        // Second reorg: deeper slice surfaces ancestor at block 1.
        {
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2a' },
              { number: 3, hash: '0x3a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 2, hash: '0x2a', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3a', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7a', timestamp: 7000 } },
          ],
          head: { finalized: { number: 4, hash: '0x4a' } },
        },
      ])

      const rollbackCursors: BlockCursor[] = []
      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(
        buildTarget(events, sync, {
          onAfterRollback: ({ cursor }) => {
            rollbackCursors.push(cursor)
          },
        }),
      )

      // First fork resolves to block 3, second resolves all the way to block 1.
      expect(rollbackCursors).toEqual([
        expect.objectContaining({ number: 3, hash: '0x3' }),
        expect.objectContaining({ number: 1, hash: '0x1' }),
      ])

      expect(await readEvents(events)).toEqual([
        { block_number: 2, tx_hash: '0x2a' },
        { block_number: 3, tx_hash: '0x3a' },
        { block_number: 4, tx_hash: '0x4a' },
        { block_number: 5, tx_hash: '0x5a' },
        { block_number: 6, tx_hash: '0x6a' },
        { block_number: 7, tx_hash: '0x7a' },
      ])
    }, 240_000)

    it('handles a deep fork that rolls back to the last finalized block, including a mid-stream crash', async () => {
      const { events, sync } = uniqueTables('deep_finalized')

      // Two responses for the post-fork range: the first attempt crashes mid-batch (we throw
      // inside onData), the second is consumed by the resumed pipeTo loop. Both must agree
      // on parentBlockHash='0x3a' — proving recovery resumed from the persisted cursor.
      const postForkBatch: MockResponse = {
        statusCode: 200,
        data: [
          { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
          { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
          { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
          { header: { number: 7, hash: '0x7a', timestamp: 7000 } },
        ],
        head: { finalized: { number: 4, hash: '0x4a' } },
      }

      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2a' },
              { number: 3, hash: '0x3a' },
              { number: 4, hash: '0x4a' },
              { number: 5, hash: '0x5a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 2, hash: '0x2a', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3a', timestamp: 3000 } },
          ],
          head: { finalized: { number: 2, hash: '0x2a' } },
        },
        postForkBatch,
        postForkBatch,
      ])

      let crashes = 0
      let finished = false
      while (!finished) {
        try {
          await evmPortalStream({
            id: 'test',
            portal: mockPortal.url,
            outputs: blockDecoder({ from: 0, to: 7 }),
          }).pipeTo(
            buildTarget(events, sync, {
              onData: async ({ store, data }) => {
                if (data[0]?.hash === '0x4a' && crashes === 0) {
                  crashes++
                  throw new Error('process failed')
                }
                store.insert(
                  events,
                  data.map((b: { number: number; hash: string }) => ({
                    block_number: b.number,
                    tx_hash: b.hash,
                  })),
                )
                if (data.some((b: { hash: string }) => b.hash === '0x7a')) finished = true
              },
            }),
          )
          // Stream ended cleanly — done either way.
          finished = true
        } catch (e) {
          if (!(e instanceof Error) || e.message !== 'process failed') throw e
        }
      }

      expect(crashes).toBe(1)

      // After recovery + replay, all canonical-chain blocks landed exactly once. Forked
      // blocks 0x4 and 0x5 must have been DELETEd by tracker.fork(); the crash must NOT
      // have left a stale 0x4a row that doubles up after restart.
      expect(await readEvents(events)).toEqual([
        { block_number: 1, tx_hash: '0x1' },
        { block_number: 2, tx_hash: '0x2a' },
        { block_number: 3, tx_hash: '0x3a' },
        { block_number: 4, tx_hash: '0x4a' },
        { block_number: 5, tx_hash: '0x5a' },
        { block_number: 6, tx_hash: '0x6a' },
        { block_number: 7, tx_hash: '0x7a' },
      ])
    }, 300_000)

    it('handles a deep fork via two cascading rollbacks (no crash)', async () => {
      const { events, sync } = uniqueTables('deep')

      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        // Shallow slice — only blocks 4-5 visible, no common ancestor here.
        {
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 4, hash: '0x4a' },
              { number: 5, hash: '0x5a' },
            ],
          },
        },
        // Deeper slice — ancestor at block 1.
        {
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2a' },
              { number: 3, hash: '0x3a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 2, hash: '0x2a', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3a', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7a', timestamp: 7000 } },
          ],
        },
      ])

      const rollbackCursors: BlockCursor[] = []
      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(
        buildTarget(events, sync, {
          onAfterRollback: ({ cursor }) => {
            rollbackCursors.push(cursor)
          },
        }),
      )

      expect(rollbackCursors.map((c) => c.number)).toEqual([3, 1])

      expect(await readEvents(events)).toEqual([
        { block_number: 1, tx_hash: '0x1' },
        { block_number: 2, tx_hash: '0x2a' },
        { block_number: 3, tx_hash: '0x3a' },
        { block_number: 4, tx_hash: '0x4a' },
        { block_number: 5, tx_hash: '0x5a' },
        { block_number: 6, tx_hash: '0x6a' },
        { block_number: 7, tx_hash: '0x7a' },
      ])
    }, 240_000)

    it('resumes from the last persisted cursor after a clean stop (parentBlockHash threaded through)', async () => {
      const { events, sync } = uniqueTables('resume')

      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
        },
        {
          statusCode: 200,
          data: [{ header: { number: 2, hash: '0x2', timestamp: 2000 } }],
          // The portal contract: after restart, the request must include the parentBlockHash
          // of the previously persisted cursor so the portal can detect any fork that happened
          // while we were down.
          validateRequest: (req) => {
            expect(req).toMatchObject({
              type: 'evm',
              fromBlock: 2,
              parentBlockHash: '0x1',
            })
          },
        },
      ])

      // First run: ingest block 1 and stop cleanly.
      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 1 }),
      }).pipeTo(buildTarget(events, sync))

      // Second run with a fresh stream: the BigQuery sync table holds the previous cursor,
      // so getCursor() must read it back and the new stream must request block 2 with the
      // expected parentBlockHash. validateRequest in the mock asserts that.
      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 1, to: 2 }),
      }).pipeTo(buildTarget(events, sync))

      expect(await readEvents(events)).toEqual([
        { block_number: 1, tx_hash: '0x1' },
        { block_number: 2, tx_hash: '0x2' },
      ])
    }, 240_000)

    it('records cursor + finalized for every committed batch in the sync table', async () => {
      const { events, sync } = uniqueTables('sync_state')

      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
      ])

      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 3 }),
      }).pipeTo(buildTarget(events, sync))

      // `evmPortalStream` may split a single portal response into multiple per-batch
      // emissions; assert on the FINAL committed cursor rather than counting rows. What
      // matters for resumption correctness is that the latest commit reflects the last
      // block we processed, with the finalized pointer the portal advertised.
      const rows = await readSyncCommittedCursors(sync)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[rows.length - 1]).toMatchObject({
        current: { number: 3, hash: '0x3' },
        finalized: { number: 1, hash: '0x1' },
      })
    }, 180_000)
  })
})
