import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ParquetReader, ParquetSchema, ParquetWriter } from '@dsnp/parquetjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTarget } from '~/core/index.js'
import { evmPortalStream } from '~/evm/index.js'
import { type MockPortal, type MockResponse, blockDecoder, mockPortal, testLogger } from '~/testing/index.js'

import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import { ParquetState } from './parquet-state.js'
import { ParquetStore } from './parquet-store.js'
import { parquetTarget } from './parquet-target.js'
import type { ParquetTable } from './schema.js'
import { ParquetSegmentWriter } from './writer.js'

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type BlockRow = { blockNumber: number; hash: string; timestamp: number }
type LogRow = { blockNumber: number; logIndex: number; address: string }

const BLOCKS_TABLE: ParquetTable = {
  table: 'blocks',
  schema: {
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  },
}

/** Decoded EVM headers expose `number`/`hash`/`timestamp`; map them onto the `blocks` schema. */
const insertBlocks = ({
  store,
  data,
}: {
  store: ParquetStore
  data: { number: number; hash: string; timestamp: number }[]
}) => {
  store.insert(
    'blocks',
    data.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
  )
}

/** Builds a 200 response carrying the given block numbers, optionally with a finalized head. */
function blocksResponse(numbers: number[], finalized?: number): MockResponse {
  return {
    statusCode: 200,
    data: numbers.map((n) => ({ header: { number: n, hash: `0x${n}`, timestamp: n * 1000 } })),
    head: finalized === undefined ? undefined : { finalized: { number: finalized, hash: `0x${finalized}` } },
  }
}

/** Published data file names (excludes temp + state files), sorted lexically. */
async function listDataFiles(dir: string, table: string): Promise<string[]> {
  const entries = await readdir(path.join(dir, table)).catch(() => [] as string[])

  return entries.filter((f) => /^\d+-\d+\.parquet$/.test(f)).sort()
}

/** All entries in a table dir (to assert temp-file cleanup). */
async function listAll(dir: string, table: string): Promise<string[]> {
  return (await readdir(path.join(dir, table)).catch(() => [] as string[])).sort()
}

async function readRows<T>(dir: string, table: string, decode: (raw: Record<string, unknown>) => T): Promise<T[]> {
  const files = await listDataFiles(dir, table)
  const rows: T[] = []
  for (const file of files) {
    const reader = await ParquetReader.openFile(path.join(dir, table, file))
    const cursor = reader.getCursor()
    let raw: Record<string, unknown> | null
    while ((raw = (await cursor.next()) as Record<string, unknown> | null)) {
      rows.push(decode(raw))
    }
    await reader.close()
  }

  return rows
}

/** Reads the `blocks` table, normalized + sorted by block number. */
async function readBlocks(dir: string): Promise<BlockRow[]> {
  const rows = await readRows(dir, 'blocks', (raw) => ({
    blockNumber: Number(raw['blockNumber']),
    hash: String(raw['hash']),
    timestamp: Number(raw['timestamp']),
  }))

  return rows.sort((a, b) => a.blockNumber - b.blockNumber)
}

/** Reads the `logs` table, normalized + sorted. */
async function readLogs(dir: string): Promise<LogRow[]> {
  const rows = await readRows(dir, 'logs', (raw) => ({
    blockNumber: Number(raw['blockNumber']),
    logIndex: Number(raw['logIndex']),
    address: String(raw['address']),
  }))

  return rows.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
}

/** Writes a Parquet file directly (used to seed stale/over-cursor files for recovery tests). */
async function seedParquetFile(filePath: string, rows: BlockRow[]): Promise<void> {
  const schema = new ParquetSchema({
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  })
  const writer = await ParquetWriter.openFile(schema, filePath, { rowGroupSize: 1 })
  for (const row of rows) await writer.appendRow(row)
  await writer.close()
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('parquetTarget', () => {
  let portal: MockPortal | undefined
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-parquet-test-'))
  })

  afterEach(async () => {
    await portal?.close()
    portal = undefined
    await rm(dir, { recursive: true, force: true })
  })

  describe('block-number value guard', () => {
    it('fails loudly instead of coercing a null block number to 0, even in production', async () => {
      // Disable the dev-mode value check so the always-on block guard is what trips.
      const prev = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      portal = await mockPortal([blocksResponse([1], 1)])

      try {
        await expect(
          evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 1 }) }).pipeTo(
            parquetTarget({
              dir,
              tables: [BLOCKS_TABLE],
              onData: ({ store }) => {
                store.insert('blocks', [{ blockNumber: null as unknown as number, hash: '0x1', timestamp: 1000 }])
              },
            }),
          ),
        ).rejects.toThrowError(/finite integer/)
      } finally {
        if (prev === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = prev
      }

      // No bogus block-0 file was published.
      expect(await listDataFiles(dir, 'blocks')).toEqual([])
    })
  })

  describe('finalized-only', () => {
    it('does not write blocks above the finalized head', async () => {
      portal = await mockPortal([blocksResponse([1, 2, 3, 4, 5], 2)])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 5 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }),
      )

      // Only blocks 1–2 are finalized (head = 2); 3–5 stay buffered and are never written.
      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2])
    })

    it('publishes previously-unfinalized blocks once a later batch finalizes them', async () => {
      portal = await mockPortal([blocksResponse([1, 2, 3, 4, 5], 2), blocksResponse([6, 7], 7)])

      // maxBytes:1 keeps the two responses as distinct batches so the second batch's higher
      // finalized head genuinely releases what the first batch left buffered.
      await evmPortalStream({
        id: 'test',
        portal: { url: portal.url, maxBytes: 1 },
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }))

      // The later finalized head (7) releases the 3–5 held from the first batch.
      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
    })
  })

  describe('read-back correctness', () => {
    it('writes exactly the finalized rows with correct types and <min>-<max> filename', async () => {
      portal = await mockPortal([blocksResponse([1, 2, 3], 3)])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }),
      )

      expect(await listDataFiles(dir, 'blocks')).toEqual(['000000000001-000000000003.parquet'])
      expect(await readBlocks(dir)).toEqual([
        { blockNumber: 1, hash: '0x1', timestamp: 1000 },
        { blockNumber: 2, hash: '0x2', timestamp: 2000 },
        { blockNumber: 3, hash: '0x3', timestamp: 3000 },
      ])
    })

    it('reads INT64 columns back as bigint (input contract)', async () => {
      portal = await mockPortal([blocksResponse([1], 1)])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 1 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }),
      )

      const reader = await ParquetReader.openFile(path.join(dir, 'blocks', '000000000001-000000000001.parquet'))
      const raw = (await reader.getCursor().next()) as Record<string, unknown>
      await reader.close()
      expect(typeof raw['blockNumber']).toBe('bigint')
      expect(raw['blockNumber']).toBe(1n)
    })

    it('round-trips TIMESTAMP, DATE, JSON, STRUCT and LIST columns with the expected footer annotations', async () => {
      const kitchenSink: ParquetTable = {
        table: 'sink',
        schema: {
          blockNumber: { type: 'INT64' },
          at: { type: 'TIMESTAMP' },
          day: { type: 'DATE' },
          dayNum: { type: 'DATE' },
          meta: { type: 'JSON', optional: true },
          user: { type: 'STRUCT', fields: { name: { type: 'UTF8' }, age: { type: 'INT32', optional: true } } },
          tags: { type: 'LIST', element: { type: 'UTF8', optional: true }, optional: true },
          xfers: {
            type: 'LIST',
            element: { type: 'STRUCT', fields: { to: { type: 'UTF8' }, amt: { type: 'INT64' } } },
          },
          matrix: { type: 'LIST', element: { type: 'LIST', element: { type: 'INT32' } } },
        },
      }
      const at = new Date('2024-01-01T15:30:45.123Z')

      portal = await mockPortal([blocksResponse([1, 2], 2)])
      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 2 }) }).pipeTo(
        parquetTarget({
          dir,
          tables: [kitchenSink],
          onData: ({ store, data }) => {
            store.insert(
              'sink',
              data.map((b) => ({
                blockNumber: b.number,
                at,
                day: at, // non-midnight Date — must land on its UTC calendar day
                dayNum: 19724, // whole days since epoch = 2024-01-02
                meta: b.number === 1 ? { fee: 12, keys: ['k1', 'k2'] } : null,
                user: { name: `user-${b.number}`, age: b.number === 1 ? 30 : null },
                tags: b.number === 1 ? ['a', null, 'c'] : [],
                xfers: [{ to: '0xa', amt: 5n }],
                matrix: [[1, 2], [3]],
              })),
            )
          },
        }),
      )

      const [file] = await listDataFiles(dir, 'sink')
      const reader = await ParquetReader.openFile(path.join(dir, 'sink', file))
      const cursor = reader.getCursor()
      const rows: Record<string, unknown>[] = []
      let raw: Record<string, unknown> | null
      while ((raw = (await cursor.next()) as Record<string, unknown> | null)) rows.push(raw)

      // Legacy footer annotations (the pinned library never writes the modern LogicalType field;
      // per the format spec readers map these to the corresponding logical types):
      // TIMESTAMP_MILLIS=9 (the library's legacy spelling of TIMESTAMP), DATE=6, JSON=19, LIST=3 on the outer
      // list groups; STRUCT groups carry children but no converted_type.
      const annotations = new Map(reader.metadata!.schema.map((s) => [s.name, s.converted_type] as const))
      const children = new Map(reader.metadata!.schema.map((s) => [s.name, s.num_children] as const))
      await reader.close()
      expect(annotations.get('at')).toBe(9)
      expect(annotations.get('day')).toBe(6)
      expect(annotations.get('dayNum')).toBe(6)
      expect(annotations.get('meta')).toBe(19)
      expect(annotations.get('tags')).toBe(3)
      expect(annotations.get('xfers')).toBe(3)
      expect(annotations.get('matrix')).toBe(3)
      expect(annotations.get('user')).toBeNull()
      expect(Number(children.get('user'))).toBe(2)

      rows.sort((a, b) => Number(a['blockNumber']) - Number(b['blockNumber']))
      const [r1, r2] = rows
      expect((r1['at'] as Date).toISOString()).toBe('2024-01-01T15:30:45.123Z')
      expect((r1['day'] as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z')
      expect((r1['dayNum'] as Date).toISOString()).toBe('2024-01-02T00:00:00.000Z')
      expect(r1['meta']).toEqual({ fee: 12, keys: ['k1', 'k2'] })
      expect(r1['user']).toEqual({ name: 'user-1', age: 30 })
      // This library's reader materializes the canonical layout verbatim: wrapped elements, an
      // empty list as { list: null } (still distinct from a null column at the definition level).
      expect(r1['tags']).toEqual({ list: [{ element: 'a' }, { element: null }, { element: 'c' }] })
      expect(r1['xfers']).toEqual({ list: [{ element: { to: '0xa', amt: 5n } }] })
      // Nested lists round-trip with each level in the canonical wrapped shape.
      expect(r1['matrix']).toEqual({
        list: [{ element: { list: [{ element: 1 }, { element: 2 }] } }, { element: { list: [{ element: 3 }] } }],
      })

      expect(r2['meta']).toBeNull()
      expect(r2['user']).toEqual({ name: 'user-2', age: null })
      expect(r2['tags']).toEqual({ list: null })
    })
  })

  describe('rotation', () => {
    it('rotates into multiple files with disjoint, contiguous ranges under a small maxBytes', async () => {
      portal = await mockPortal([blocksResponse([1], 1), blocksResponse([2], 2), blocksResponse([3], 3)])

      await evmPortalStream({
        id: 'test',
        portal: { url: portal.url, maxBytes: 1 },
        outputs: blockDecoder({ from: 0, to: 3 }),
      }).pipeTo(
        parquetTarget({
          dir,
          tables: [BLOCKS_TABLE],
          settings: { rollover: { maxBytes: 1 }, rowGroupSize: 1 },
          onData: insertBlocks,
        }),
      )

      expect(await listDataFiles(dir, 'blocks')).toEqual([
        '000000000001-000000000001.parquet',
        '000000000002-000000000002.parquet',
        '000000000003-000000000003.parquet',
      ])
      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2, 3])
    })
  })

  describe('recovery', () => {
    it('removes over-cursor and temp files, resumes from the cursor, stays duplicate-free', async () => {
      // Seed a committed cursor at block 2, a stale data file above it, and an orphan temp file.
      // The state file is namespaced by the pipe id ('test') the runs below use.
      await writeFile(
        path.join(dir, '_sqd_parquet_state.test.json'),
        JSON.stringify({ cursor: { number: 2, hash: '0x2' } }),
      )
      const blocksDir = path.join(dir, 'blocks')
      await mkdir(blocksDir, { recursive: true })
      await seedParquetFile(path.join(blocksDir, '000000000003-000000000005.parquet'), [
        { blockNumber: 3, hash: 'STALE', timestamp: 0 },
      ])
      await writeFile(path.join(blocksDir, '.tmp-orphan.parquet'), 'garbage')

      portal = await mockPortal([
        {
          ...blocksResponse([3, 4, 5], 5),
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 3, parentBlockHash: '0x2' })
          },
        },
      ])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 5 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }),
      )

      // The stale STALE-hash row was deleted and replaced by correct, duplicate-free data.
      expect(await readBlocks(dir)).toEqual([
        { blockNumber: 3, hash: '0x3', timestamp: 3000 },
        { blockNumber: 4, hash: '0x4', timestamp: 4000 },
        { blockNumber: 5, hash: '0x5', timestamp: 5000 },
      ])
      // No orphan temp file survives recovery.
      expect((await listAll(dir, 'blocks')).some((f) => f.startsWith('.tmp-'))).toBe(false)
    })
  })

  describe('finalized watermark (persist + restart)', () => {
    it('persists the source-clamped finalized head through the loop at checkpoint', async () => {
      portal = await mockPortal([blocksResponse([1, 2, 3], 3)])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }),
      )

      // The loop threads the finalized head into saveCursor, so the state file (namespaced by the
      // pipe id) carries it for the source to re-seed its watermark on restart.
      const persisted = JSON.parse(await readFile(path.join(dir, '_sqd_parquet_state.test.json'), 'utf8'))
      expect(persisted.cursor).toEqual({ number: 3, hash: '0x3' })
      expect(persisted.finalized).toEqual({ number: 3, hash: '0x3' })
    })

    it('re-seeds the watermark from a real persisted finalized head and clamps a regression below it', async () => {
      // A real ParquetState persists a finalized head of 5, exactly as the target loop would.
      const persistState = new ParquetState({ dir, tables: ['blocks'], logger: testLogger() })
      await persistState.getCursor()
      await persistState.saveCursor({ number: 5, hash: '0x5' }, { number: 5, hash: '0x5f' })

      // Restart: a real getCursor hands that finalized head back as resume state.
      const resume = await new ParquetState({ dir, tables: ['blocks'], logger: testLogger() }).getCursor()
      expect(resume).toEqual({ latest: { number: 5, hash: '0x5' }, finalized: { number: 5, hash: '0x5f' } })

      // The source seeds its floor from the persisted finalized and clamps a lower reported head.
      portal = await mockPortal([blocksResponse([6], 3)])
      const seen: unknown[] = []
      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 6 }) }).pipeTo(
        createTarget({
          write: async ({ read }) => {
            for await (const { ctx } of read(resume)) {
              seen.push(ctx.stream.head.finalized)
            }
          },
        }) as any,
      )

      // The persisted floor (5) survives the restart and clamps the lower reported head (3).
      expect(seen).toEqual([{ number: 5, hash: '0x5f' }])
    })
  })

  describe('fork', () => {
    it('drops buffered forked rows and leaves the pre-fork published file intact', async () => {
      portal = await mockPortal([
        blocksResponse([1, 2, 3, 4, 5], 1),
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
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7a', timestamp: 7000 } },
          ],
          head: { finalized: { number: 7, hash: '0x7a' } },
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 4, parentBlockHash: '0x3' })
          },
        },
      ])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 7 }) }).pipeTo(
        parquetTarget({
          dir,
          tables: [BLOCKS_TABLE],
          // Checkpoint every batch so block 1 is published before the fork fires.
          settings: { rollover: { intervalBlocks: 1 } },
          onData: insertBlocks,
        }),
      )

      // Forked blocks (0x4-1 / 0x5-1) were dropped from the buffer; the new chain replaces them.
      expect(await readBlocks(dir)).toEqual([
        { blockNumber: 1, hash: '0x1', timestamp: 1000 },
        { blockNumber: 2, hash: '0x2', timestamp: 2000 },
        { blockNumber: 3, hash: '0x3', timestamp: 3000 },
        { blockNumber: 4, hash: '0x4a', timestamp: 4000 },
        { blockNumber: 5, hash: '0x5a', timestamp: 5000 },
        { blockNumber: 6, hash: '0x6a', timestamp: 6000 },
        { blockNumber: 7, hash: '0x7a', timestamp: 7000 },
      ])
      // The block-1 file was published before the reorg and must survive it untouched.
      expect(await listDataFiles(dir, 'blocks')).toContain('000000000001-000000000001.parquet')
    })

    it('drops forked rows in every table buffer, not just the first (multi-table)', async () => {
      const logsTable: ParquetTable = {
        table: 'logs',
        schema: {
          blockNumber: { type: 'INT64' },
          logIndex: { type: 'INT32' },
          address: { type: 'UTF8' },
        },
      }
      portal = await mockPortal([
        blocksResponse([1, 2, 3, 4, 5], 1),
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
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7a', timestamp: 7000 } },
          ],
          head: { finalized: { number: 7, hash: '0x7a' } },
        },
      ])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 7 }) }).pipeTo(
        parquetTarget({
          dir,
          tables: [BLOCKS_TABLE, logsTable],
          onData: ({ store, data }) => {
            store.insert(
              'blocks',
              data.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
            )
            // One log row per block, tagged with the block hash so the forked chain (0x4-1 / 0x5-1)
            // is distinguishable from the replacement chain (0x4a / 0x5a).
            store.insert(
              'logs',
              data.map((b) => ({ blockNumber: b.number, logIndex: 0, address: b.hash })),
            )
          },
        }),
      )

      // Both tables dropped the forked rows: no duplicate block 4/5 in either. If fork() had
      // dropped rows in only the first buffer, the logs table would still carry the stale forked
      // rows (blockNumbers [1, 2, 3, 4, 4, 5, 5, 6, 7]).
      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
      const logs = await readLogs(dir)
      expect(logs.map((r) => r.blockNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
      // Blocks 4 & 5 in the logs table carry the replacement-chain hash, proving the drop happened.
      expect(logs.find((r) => r.blockNumber === 4)?.address).toBe('0x4a')
      expect(logs.find((r) => r.blockNumber === 5)?.address).toBe('0x5a')
    })
  })

  describe('empty table', () => {
    it('produces no file for a declared table that receives no rows', async () => {
      const emptyTable: ParquetTable = { table: 'empty', schema: { blockNumber: { type: 'INT64' } } }
      portal = await mockPortal([blocksResponse([1, 2, 3], 3)])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE, emptyTable], onData: insertBlocks }),
      )

      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2, 3])
      // The empty table's directory exists but holds no parquet file.
      expect(await listDataFiles(dir, 'empty')).toEqual([])
    })
  })

  describe('no-finality passthrough', () => {
    it('writes every row immediately when there is no finalized head', async () => {
      // No `head` → no finalized head → threshold Infinity → nothing is buffered.
      portal = await mockPortal([blocksResponse([1, 2, 3])])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }),
      )

      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2, 3])
    })
  })

  describe('multi-table', () => {
    it('writes independent files per table from the same batch', async () => {
      const logsTable: ParquetTable = {
        table: 'logs',
        schema: {
          blockNumber: { type: 'INT64' },
          logIndex: { type: 'INT32' },
          address: { type: 'UTF8' },
        },
      }
      portal = await mockPortal([blocksResponse([1, 2, 3], 3)])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
        parquetTarget({
          dir,
          tables: [BLOCKS_TABLE, logsTable],
          onData: ({ store, data }) => {
            store.insert(
              'blocks',
              data.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
            )
            // Two log rows per block, giving the logs table a different shape + cardinality.
            store.insert(
              'logs',
              data.flatMap((b) => [
                { blockNumber: b.number, logIndex: 0, address: `0xa${b.number}` },
                { blockNumber: b.number, logIndex: 1, address: `0xb${b.number}` },
              ]),
            )
          },
        }),
      )

      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2, 3])
      expect(await readLogs(dir)).toEqual([
        { blockNumber: 1, logIndex: 0, address: '0xa1' },
        { blockNumber: 1, logIndex: 1, address: '0xb1' },
        { blockNumber: 2, logIndex: 0, address: '0xa2' },
        { blockNumber: 2, logIndex: 1, address: '0xb2' },
        { blockNumber: 3, logIndex: 0, address: '0xa3' },
        { blockNumber: 3, logIndex: 1, address: '0xb3' },
      ])
      // Each table published its own single file covering blocks 1–3.
      expect(await listDataFiles(dir, 'blocks')).toEqual(['000000000001-000000000003.parquet'])
      expect(await listDataFiles(dir, 'logs')).toEqual(['000000000001-000000000003.parquet'])
    })
  })

  describe('store.insert guard', () => {
    it('throws synchronously when inserting into an undeclared table', async () => {
      portal = await mockPortal([blocksResponse([1], 1)])

      await expect(
        evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 1 }) }).pipeTo(
          parquetTarget({
            dir,
            tables: [BLOCKS_TABLE],
            onData: ({ store }) => {
              store.insert('not_declared', [{ blockNumber: 1 }])
            },
          }),
        ),
      ).rejects.toThrowError(/not declared/)
    })

    it('accumulates multiple inserts into the same table within a batch', async () => {
      portal = await mockPortal([blocksResponse([1, 2], 2)])

      await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 2 }) }).pipeTo(
        parquetTarget({
          dir,
          tables: [BLOCKS_TABLE],
          onData: ({ store, data }) => {
            // Two separate inserts for the same table must both be staged + flushed.
            for (const b of data) {
              store.insert('blocks', [{ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp }])
            }
          },
        }),
      )

      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2])
    })
  })

  describe('crash safety', () => {
    it('discards open temp files and does not advance the cursor when a batch throws', async () => {
      // Batch 1 opens a writer with a finalized row (no checkpoint — huge default maxBytes);
      // batch 2 throws before any checkpoint, so the open temp file must be discarded and the
      // cursor must never be persisted. maxBytes:1 forces one batch per response.
      portal = await mockPortal([blocksResponse([1], 1), blocksResponse([2], 2)])

      let batches = 0
      await expect(
        evmPortalStream({
          id: 'test',
          portal: { url: portal.url, maxBytes: 1 },
          outputs: blockDecoder({ from: 0, to: 2 }),
        }).pipeTo(
          parquetTarget({
            dir,
            tables: [BLOCKS_TABLE],
            onData: ({ store, data }) => {
              insertBlocks({ store, data })
              batches++
              if (batches === 2) throw new Error('boom')
            },
          }),
        ),
      ).rejects.toThrowError('boom')

      // No file was published (the open writer was discarded, not finalized)...
      expect(await listDataFiles(dir, 'blocks')).toEqual([])
      // ...no temp file leaked...
      expect((await listAll(dir, 'blocks')).filter((f) => f.startsWith('.tmp-'))).toEqual([])
      // ...and the cursor was never persisted (no checkpoint happened). The pipe runs with
      // id 'test', so the namespaced state file is the one that must be absent.
      expect((await listAll(dir, '')).includes('_sqd_parquet_state.test.json')).toBe(false)
    })
  })

  describe('ParquetSegmentWriter', () => {
    it('lazy-opens, tracks range/rowCount, and publishes <min>-<max>', async () => {
      const segDir = path.join(dir, 'seg')
      await mkdir(segDir, { recursive: true })
      const schema = new ParquetSchema({ blockNumber: { type: 'INT64' } })

      const writer = new ParquetSegmentWriter({ dir: segDir, schema, rowGroupSize: 1 })
      expect(writer.isOpen).toBe(false)
      expect(await writer.size()).toBe(0)

      await writer.appendRow({ blockNumber: 5 }, 5)
      await writer.appendRow({ blockNumber: 8 }, 8)
      expect(writer.isOpen).toBe(true)
      expect(writer.rowCount).toBe(2)
      expect(writer.minBlock).toBe(5)
      expect(writer.maxBlock).toBe(8)
      expect(await writer.size()).toBeGreaterThan(0)

      const published = await writer.publish()
      expect(published.path.endsWith('000000000005-000000000008.parquet')).toBe(true)
      expect(published.rows).toBe(2)
      expect(published.bytes).toBeGreaterThan(0)
    })

    it('refuses to overwrite an existing file (collision)', async () => {
      const segDir = path.join(dir, 'seg')
      await mkdir(segDir, { recursive: true })
      const schema = new ParquetSchema({ blockNumber: { type: 'INT64' } })

      const first = new ParquetSegmentWriter({ dir: segDir, schema, rowGroupSize: 1 })
      await first.appendRow({ blockNumber: 1 }, 1)
      await first.publish()

      const second = new ParquetSegmentWriter({ dir: segDir, schema, rowGroupSize: 1 })
      await second.appendRow({ blockNumber: 1 }, 1)
      await expect(second.publish()).rejects.toThrowError(/Refusing to overwrite/)
      await second.discard()
    })

    it('discard() removes the temp file of an unpublished segment', async () => {
      const segDir = path.join(dir, 'seg')
      await mkdir(segDir, { recursive: true })
      const schema = new ParquetSchema({ blockNumber: { type: 'INT64' } })

      const writer = new ParquetSegmentWriter({ dir: segDir, schema, rowGroupSize: 1 })
      await writer.appendRow({ blockNumber: 1 }, 1)
      await writer.discard()

      expect((await readdir(segDir)).filter((f) => f.startsWith('.tmp-'))).toEqual([])
    })

    it('discard() releases the stream and is safe to call twice', async () => {
      // Exercises the error-path fd cleanup: destroy the owned stream, idempotently, with no throw.
      const segDir = path.join(dir, 'seg')
      await mkdir(segDir, { recursive: true })
      const schema = new ParquetSchema({ blockNumber: { type: 'INT64' } })

      const writer = new ParquetSegmentWriter({ dir: segDir, schema, rowGroupSize: 1 })
      await writer.appendRow({ blockNumber: 1 }, 1)
      await writer.discard()
      await writer.discard()

      expect((await readdir(segDir)).filter((f) => f.startsWith('.tmp-'))).toEqual([])
    })
  })

  describe('ParquetState', () => {
    it('throws STATE_CORRUPT on an unparseable state file', async () => {
      await writeFile(path.join(dir, '_sqd_parquet_state.json'), 'not-json')
      const state = new ParquetState({ dir, tables: ['blocks'], logger: testLogger() })

      await expect(state.getCursor()).rejects.toThrowError(/could not be parsed/)
    })

    it('returns undefined on a cold start and creates table directories', async () => {
      const state = new ParquetState({ dir, tables: ['blocks'], logger: testLogger() })

      expect(await state.getCursor()).toBeUndefined()
      expect(await listAll(dir, 'blocks')).toEqual([])
    })

    it('returns the persisted cursor and finalized head as resume state', async () => {
      await writeFile(
        path.join(dir, '_sqd_parquet_state.json'),
        JSON.stringify({ cursor: { number: 5, hash: '0x5' }, finalized: { number: 5, hash: '0x5f' } }),
      )
      const state = new ParquetState({ dir, tables: ['blocks'], logger: testLogger() })

      expect(await state.getCursor()).toEqual({
        latest: { number: 5, hash: '0x5' },
        finalized: { number: 5, hash: '0x5f' },
      })
    })

    it('returns finalized: null for state written before the finalized field existed', async () => {
      await writeFile(path.join(dir, '_sqd_parquet_state.json'), JSON.stringify({ cursor: { number: 5, hash: '0x5' } }))
      const state = new ParquetState({ dir, tables: ['blocks'], logger: testLogger() })

      expect(await state.getCursor()).toEqual({ latest: { number: 5, hash: '0x5' }, finalized: null })
    })

    it('persists the finalized head alongside the cursor so the source can re-seed on restart', async () => {
      const state = new ParquetState({ dir, tables: ['blocks'], logger: testLogger() })
      await state.getCursor()

      await state.saveCursor({ number: 7, hash: '0x7' }, { number: 7, hash: '0x7f' })

      const persisted = JSON.parse(await readFile(path.join(dir, '_sqd_parquet_state.json'), 'utf8'))
      expect(persisted).toMatchObject({
        cursor: { number: 7, hash: '0x7' },
        finalized: { number: 7, hash: '0x7f' },
      })
    })

    it('throws (does not silently leave overlap) when an over-cursor file cannot be deleted', async () => {
      await writeFile(path.join(dir, '_sqd_parquet_state.json'), JSON.stringify({ cursor: { number: 2, hash: '0x2' } }))
      // A *directory* named like a data file cannot be unlink()-ed (EISDIR/EPERM, even as root),
      // forcing the recovery delete to fail; it must surface rather than leave a duplicate-causing file.
      await mkdir(path.join(dir, 'blocks', '000000000003-000000000005.parquet'), { recursive: true })
      const state = new ParquetState({ dir, tables: ['blocks'], logger: testLogger() })

      expect.assertions(1)
      try {
        await state.getCursor()
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PARQUET_ERROR_CODES.RECOVERY_DELETE_FAILED)
      }
    })
  })
})

describe('parquet index barrel', () => {
  it('re-exports the public API', async () => {
    const mod = await import('./index.js')
    expect(typeof mod.parquetTarget).toBe('function')
    expect(typeof mod.ParquetStore).toBe('function')
    expect(typeof mod.ParquetTargetError).toBe('function')
    expect(mod.PARQUET_ERROR_CODES.NO_TABLES).toBe('E1201')
  })
})
