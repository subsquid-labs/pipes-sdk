import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ParquetReader, ParquetSchema, ParquetWriter } from '@dsnp/parquetjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evmPortalStream } from '~/evm/index.js'
import {
  type MockPortal,
  type MockResponse,
  blockDecoder,
  createMockPortal,
  createTestLogger,
} from '~/testing/index.js'

import { PQ_ERR, ParquetTargetError } from './errors.js'
import { ParquetState } from './parquet-state.js'
import type { ParquetStore } from './parquet-store.js'
import { parquetTarget } from './parquet-target.js'
import { type ParquetTable, validateTables } from './schema.js'
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
  let mockPortal: MockPortal | undefined
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-parquet-test-'))
  })

  afterEach(async () => {
    await mockPortal?.close()
    mockPortal = undefined
    await rm(dir, { recursive: true, force: true })
  })

  describe('schema validation', () => {
    it('rejects an empty tables list', () => {
      expect.assertions(1)
      try {
        validateTables([])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PQ_ERR.NO_TABLES)
      }
    })

    it('rejects a schema missing the block-number column', () => {
      expect.assertions(1)
      try {
        validateTables([{ table: 't', schema: { hash: { type: 'UTF8' } } }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PQ_ERR.BLOCK_COLUMN_MISSING)
      }
    })

    it('rejects a non-integer block-number column', () => {
      expect.assertions(1)
      try {
        validateTables([{ table: 't', schema: { blockNumber: { type: 'UTF8' } } }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PQ_ERR.BLOCK_COLUMN_TYPE)
      }
    })

    it('rejects duplicate table names', () => {
      expect.assertions(1)
      try {
        validateTables([BLOCKS_TABLE, BLOCKS_TABLE])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PQ_ERR.DUPLICATE_TABLE)
      }
    })

    it('rejects an empty schema', () => {
      expect.assertions(1)
      try {
        validateTables([{ table: 't', schema: {} }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PQ_ERR.EMPTY_SCHEMA)
      }
    })

    it('rejects an unsupported column type', () => {
      expect.assertions(1)
      try {
        validateTables([
          { table: 't', schema: { blockNumber: { type: 'INT64' }, amount: { type: 'DECIMAL' as never } } },
        ])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PQ_ERR.UNSUPPORTED_TYPE)
      }
    })

    it('rejects an unsupported compression codec', () => {
      expect.assertions(1)
      try {
        validateTables([{ table: 't', schema: { blockNumber: { type: 'INT64', compression: 'ZSTD' as never } } }])
      } catch (e) {
        expect((e as ParquetTargetError).code).toBe(PQ_ERR.UNSUPPORTED_COMPRESSION)
      }
    })
  })

  describe('finalized-only', () => {
    it('does not write blocks above the finalized head', async () => {
      mockPortal = await createMockPortal([blocksResponse([1, 2, 3, 4, 5], 2)])

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 5 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }),
      )

      // Only blocks 1–2 are finalized (head = 2); 3–5 stay buffered and are never written.
      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2])
    })

    it('publishes previously-unfinalized blocks once a later batch finalizes them', async () => {
      mockPortal = await createMockPortal([blocksResponse([1, 2, 3, 4, 5], 2), blocksResponse([6, 7], 7)])

      // maxBytes:1 keeps the two responses as distinct batches so the second batch's higher
      // finalized head genuinely releases what the first batch left buffered.
      await evmPortalStream({
        id: 'test',
        portal: { url: mockPortal.url, maxBytes: 1 },
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }))

      // The later finalized head (7) releases the 3–5 held from the first batch.
      expect((await readBlocks(dir)).map((r) => r.blockNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
    })
  })

  describe('read-back correctness', () => {
    it('writes exactly the finalized rows with correct types and <min>-<max> filename', async () => {
      mockPortal = await createMockPortal([blocksResponse([1, 2, 3], 3)])

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
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
      mockPortal = await createMockPortal([blocksResponse([1], 1)])

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 1 }) }).pipeTo(
        parquetTarget({ dir, tables: [BLOCKS_TABLE], onData: insertBlocks }),
      )

      const reader = await ParquetReader.openFile(path.join(dir, 'blocks', '000000000001-000000000001.parquet'))
      const raw = (await reader.getCursor().next()) as Record<string, unknown>
      await reader.close()
      expect(typeof raw['blockNumber']).toBe('bigint')
      expect(raw['blockNumber']).toBe(1n)
    })
  })

  describe('rotation', () => {
    it('rotates into multiple files with disjoint, contiguous ranges under a small maxBytes', async () => {
      mockPortal = await createMockPortal([blocksResponse([1], 1), blocksResponse([2], 2), blocksResponse([3], 3)])

      await evmPortalStream({
        id: 'test',
        portal: { url: mockPortal.url, maxBytes: 1 },
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
      await writeFile(path.join(dir, '_sqd_parquet_state.json'), JSON.stringify({ cursor: { number: 2, hash: '0x2' } }))
      const blocksDir = path.join(dir, 'blocks')
      await mkdir(blocksDir, { recursive: true })
      await seedParquetFile(path.join(blocksDir, '000000000003-000000000005.parquet'), [
        { blockNumber: 3, hash: 'STALE', timestamp: 0 },
      ])
      await writeFile(path.join(blocksDir, '.tmp-orphan.parquet'), 'garbage')

      mockPortal = await createMockPortal([
        {
          ...blocksResponse([3, 4, 5], 5),
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 3, parentBlockHash: '0x2' })
          },
        },
      ])

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 5 }) }).pipeTo(
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

  describe('fork', () => {
    it('drops buffered forked rows and leaves the pre-fork published file intact', async () => {
      mockPortal = await createMockPortal([
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

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 7 }) }).pipeTo(
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
  })

  describe('empty table', () => {
    it('produces no file for a declared table that receives no rows', async () => {
      const emptyTable: ParquetTable = { table: 'empty', schema: { blockNumber: { type: 'INT64' } } }
      mockPortal = await createMockPortal([blocksResponse([1, 2, 3], 3)])

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
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
      mockPortal = await createMockPortal([blocksResponse([1, 2, 3])])

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
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
      mockPortal = await createMockPortal([blocksResponse([1, 2, 3], 3)])

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
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
      mockPortal = await createMockPortal([blocksResponse([1], 1)])

      await expect(
        evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 1 }) }).pipeTo(
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
      mockPortal = await createMockPortal([blocksResponse([1, 2], 2)])

      await evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 2 }) }).pipeTo(
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
      mockPortal = await createMockPortal([blocksResponse([1], 1), blocksResponse([2], 2)])

      let batches = 0
      await expect(
        evmPortalStream({
          id: 'test',
          portal: { url: mockPortal.url, maxBytes: 1 },
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
      // ...and the cursor was never persisted (no checkpoint happened).
      expect((await listAll(dir, '')).includes('_sqd_parquet_state.json')).toBe(false)
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
  })

  describe('ParquetState', () => {
    it('throws STATE_CORRUPT on an unparseable state file', async () => {
      await writeFile(path.join(dir, '_sqd_parquet_state.json'), 'not-json')
      const state = new ParquetState({ dir, tables: ['blocks'], logger: createTestLogger() })

      await expect(state.getCursor()).rejects.toThrowError(/could not be parsed/)
    })

    it('returns undefined on a cold start and creates table directories', async () => {
      const state = new ParquetState({ dir, tables: ['blocks'], logger: createTestLogger() })

      expect(await state.getCursor()).toBeUndefined()
      expect(await listAll(dir, 'blocks')).toEqual([])
    })
  })
})

describe('parquet index barrel', () => {
  it('re-exports the public API', async () => {
    const mod = await import('./index.js')
    expect(typeof mod.parquetTarget).toBe('function')
    expect(typeof mod.ParquetStore).toBe('function')
    expect(typeof mod.ParquetTargetError).toBe('function')
    expect(mod.PQ_ERR.NO_TABLES).toBe('E1201')
  })
})
