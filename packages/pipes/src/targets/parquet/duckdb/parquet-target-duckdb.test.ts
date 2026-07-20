import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ParquetReader } from '@dsnp/parquetjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evmPortalStream } from '~/evm/index.js'
import { type MockPortal, type MockResponse, blockDecoder, mockPortal } from '~/testing/index.js'

import type { ParquetSettings } from '../parquet-target.js'
import { parquetTarget } from '../parquet-target.js'
import { parquetjsEngine } from '../parquetjs-writer.js'
import type { ParquetTable } from '../schema.js'
import { acquireDuckdbInstance } from './duckdb-engine.js'
import { escapeSqlString } from './duckdb-schema.js'
import { duckdbEngine } from './duckdb-writer.js'

const BLOCKS_TABLE: ParquetTable = {
  table: 'blocks',
  schema: {
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  },
}

const KITCHEN_SINK: ParquetTable = {
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

const SINK_AT = new Date('2024-01-01T15:30:45.123Z')

/** Same row-shape builder for both engines, so differential runs are literally identical. */
function sinkRow(blockNumber: number) {
  return {
    blockNumber,
    at: SINK_AT,
    day: SINK_AT, // non-midnight Date — must land on its UTC calendar day
    dayNum: 19724, // whole days since epoch = 2024-01-02
    meta: blockNumber === 1 ? { fee: 12, keys: ['k1', 'k2'] } : null,
    user: { name: `user-${blockNumber}`, age: blockNumber === 1 ? 30 : null },
    tags: blockNumber === 1 ? ['a', null, 'c'] : [],
    xfers: [{ to: '0xa', amt: 5n }],
    matrix: [[1, 2], [3]],
  }
}

function blocksResponse(numbers: number[], finalized?: number): MockResponse {
  return {
    statusCode: 200,
    data: numbers.map((n) => ({ header: { number: n, hash: `0x${n}`, timestamp: n * 1000 } })),
    head: finalized === undefined ? undefined : { finalized: { number: finalized, hash: `0x${finalized}` } },
  }
}

async function listDataFiles(dir: string, table: string): Promise<string[]> {
  const entries = await readdir(path.join(dir, table)).catch(() => [] as string[])

  return entries.filter((f) => /^\d+-\d+\.parquet$/.test(f)).sort()
}

/** Runs one pipe over the given responses into `dir/sink` with the requested engine. */
async function runSinkPipe(
  dir: string,
  engine: NonNullable<ParquetSettings['engine']>,
  portal: MockPortal,
): Promise<void> {
  await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 2 }) }).pipeTo(
    parquetTarget({
      dir,
      tables: [KITCHEN_SINK],
      settings: { engine },
      onData: ({ store, data }) => {
        store.insert(
          'sink',
          data.map((b) => sinkRow(b.number)),
        )
      },
    }),
  )
}

describe('parquetTarget engine: duckdb', () => {
  let portal: MockPortal | undefined
  let portalB: MockPortal | undefined
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-parquet-duckdb-test-'))
  })

  afterEach(async () => {
    await portal?.close()
    await portalB?.close()
    portal = undefined
    portalB = undefined
    await rm(dir, { recursive: true, force: true })
  })

  it('rejects per-column compression at construction (one file-level codec only)', () => {
    const table: ParquetTable = {
      table: 'blocks',
      schema: { blockNumber: { type: 'INT64' }, hash: { type: 'UTF8', compression: 'GZIP' } },
    }

    expect(() =>
      parquetTarget({ dir, tables: [table], settings: { engine: duckdbEngine() }, onData: () => {} }),
    ).toThrowError(/per-column compression/)
  })

  it('writes exactly the finalized rows with <min>-<max> naming', async () => {
    portal = await mockPortal([blocksResponse([1, 2, 3, 4, 5], 3)])

    await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 5 }) }).pipeTo(
      parquetTarget({
        dir,
        tables: [BLOCKS_TABLE],
        settings: { engine: duckdbEngine() },
        onData: ({ store, data }) => {
          store.insert(
            'blocks',
            data.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
          )
        },
      }),
    )

    // Blocks 4–5 are above the finalized head and must stay unwritten.
    expect(await listDataFiles(dir, 'blocks')).toEqual(['000000000001-000000000003.parquet'])
    const reader = await ParquetReader.openFile(path.join(dir, 'blocks', '000000000001-000000000003.parquet'))
    const cursor = reader.getCursor()
    const rows: Record<string, unknown>[] = []
    let raw: Record<string, unknown> | null
    while ((raw = (await cursor.next()) as Record<string, unknown> | null)) rows.push(raw)
    await reader.close()
    expect(rows.map((r) => [r['blockNumber'], r['hash'], r['timestamp']])).toEqual([
      [1n, '0x1', 1000n],
      [2n, '0x2', 2000n],
      [3n, '0x3', 3000n],
    ])
  })

  it('rotates into multiple files with disjoint ranges under a small maxBytes', async () => {
    // The duckdb size() estimate is ≥512 bytes/row from the first row, so maxBytes: 1 rotates
    // at every batch boundary exactly like the parquetjs stat()-based test.
    portal = await mockPortal([blocksResponse([1], 1), blocksResponse([2], 2), blocksResponse([3], 3)])

    await evmPortalStream({
      id: 'test',
      portal: { url: portal.url, maxBytes: 1 },
      outputs: blockDecoder({ from: 0, to: 3 }),
    }).pipeTo(
      parquetTarget({
        dir,
        tables: [BLOCKS_TABLE],
        settings: { engine: duckdbEngine(), rollover: { maxBytes: 1 }, rowGroupSize: 1 },
        onData: ({ store, data }) => {
          store.insert(
            'blocks',
            data.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
          )
        },
      }),
    )

    expect(await listDataFiles(dir, 'blocks')).toEqual([
      '000000000001-000000000001.parquet',
      '000000000002-000000000002.parquet',
      '000000000003-000000000003.parquet',
    ])
  })

  it('round-trips the kitchen sink with the same values and footer annotations as parquetjs', async () => {
    portal = await mockPortal([blocksResponse([1, 2], 2)])
    await runSinkPipe(dir, duckdbEngine(), portal)

    const [file] = await listDataFiles(dir, 'sink')
    const reader = await ParquetReader.openFile(path.join(dir, 'sink', file))
    const cursor = reader.getCursor()
    const rows: Record<string, unknown>[] = []
    let raw: Record<string, unknown> | null
    while ((raw = (await cursor.next()) as Record<string, unknown> | null)) rows.push(raw)

    // Same legacy converted_type annotations the parquetjs engine is pinned to (see the
    // parquetjs kitchen-sink test): TIMESTAMP_MILLIS=9, DATE=6, JSON=19, LIST=3, STRUCT=none.
    // DuckDB divergence, pinned intentionally: INT64 leaves carry INT_64=18 (parquetjs: none).
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
    expect(annotations.get('blockNumber')).toBe(18)
    expect(Number(children.get('user'))).toBe(2)

    rows.sort((a, b) => Number(a['blockNumber']) - Number(b['blockNumber']))
    const [r1, r2] = rows
    expect((r1['at'] as Date).toISOString()).toBe('2024-01-01T15:30:45.123Z')
    expect((r1['day'] as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect((r1['dayNum'] as Date).toISOString()).toBe('2024-01-02T00:00:00.000Z')
    expect(r1['meta']).toEqual({ fee: 12, keys: ['k1', 'k2'] })
    expect(r1['user']).toEqual({ name: 'user-1', age: 30 })
    expect(r1['tags']).toEqual({ list: [{ element: 'a' }, { element: null }, { element: 'c' }] })
    expect(r1['xfers']).toEqual({ list: [{ element: { to: '0xa', amt: 5n } }] })
    expect(r1['matrix']).toEqual({
      list: [{ element: { list: [{ element: 1 }, { element: 2 }] } }, { element: { list: [{ element: 3 }] } }],
    })
    expect(r2['meta']).toBeNull()
    expect(r2['user']).toEqual({ name: 'user-2', age: null })
    expect(r2['tags']).toEqual({ list: null })
  })

  it('writes value-identical files to the parquetjs engine (EXCEPT differential, both directions)', async () => {
    const dirA = path.join(dir, 'parquetjs')
    const dirB = path.join(dir, 'duckdb')
    portal = await mockPortal([blocksResponse([1, 2], 2)])
    portalB = await mockPortal([blocksResponse([1, 2], 2)])

    await runSinkPipe(dirA, parquetjsEngine(), portal)
    await runSinkPipe(dirB, duckdbEngine(), portalB)

    // Same rows + same rotation decisions ⇒ same published file names.
    expect(await listDataFiles(dirB, 'sink')).toEqual(await listDataFiles(dirA, 'sink'))

    const instance = await acquireDuckdbInstance()
    const connection = await instance.connect()
    try {
      const cols = '"blockNumber", "at", "day", "dayNum", "meta", "user", "tags", "xfers", "matrix"'
      const globA = escapeSqlString(path.join(dirA, 'sink', '*.parquet'))
      const globB = escapeSqlString(path.join(dirB, 'sink', '*.parquet'))
      const aMinusB = await connection.runAndReadAll(
        `SELECT ${cols} FROM read_parquet('${globA}') EXCEPT SELECT ${cols} FROM read_parquet('${globB}')`,
      )
      const bMinusA = await connection.runAndReadAll(
        `SELECT ${cols} FROM read_parquet('${globB}') EXCEPT SELECT ${cols} FROM read_parquet('${globA}')`,
      )

      expect(aMinusB.getRowObjects()).toEqual([])
      expect(bMinusA.getRowObjects()).toEqual([])
    } finally {
      connection.disconnectSync()
    }
  })

  it('discards open temp files, leaks no staging table and never advances the cursor when a batch throws', async () => {
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
          settings: { engine: duckdbEngine() },
          onData: ({ store, data }) => {
            store.insert(
              'blocks',
              data.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
            )
            batches++
            if (batches === 2) throw new Error('boom')
          },
        }),
      ),
    ).rejects.toThrowError('boom')

    expect(await listDataFiles(dir, 'blocks')).toEqual([])
    const entries = await readdir(path.join(dir, 'blocks'))
    expect(entries.filter((f) => f.startsWith('.tmp-'))).toEqual([])
    expect((await readdir(dir)).includes('_sqd_parquet_state.test.json')).toBe(false)

    const instance = await acquireDuckdbInstance()
    const connection = await instance.connect()
    try {
      const result = await connection.runAndReadAll(
        "SELECT count(*) AS n FROM duckdb_tables() WHERE table_name LIKE 'seg_%'",
      )
      expect(Number((result.getRowObjects()[0] as { n: bigint }).n)).toBe(0)
    } finally {
      connection.disconnectSync()
    }
  })

  it('recovers from a stale over-cursor file and an orphan temp file, staying duplicate-free', async () => {
    await writeFile(
      path.join(dir, '_sqd_parquet_state.test.json'),
      JSON.stringify({ cursor: { number: 2, hash: '0x2' } }),
    )
    const blocksDir = path.join(dir, 'blocks')
    await mkdir(blocksDir, { recursive: true })
    await writeFile(path.join(blocksDir, '.tmp-orphan.parquet'), 'garbage')
    // Over-cursor remnant of an incomplete checkpoint; recovery must delete it before resuming.
    await writeFile(path.join(blocksDir, '000000000003-000000000005.parquet'), 'stale-not-even-parquet')

    portal = await mockPortal([blocksResponse([3, 4, 5], 5)])

    await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 5 }) }).pipeTo(
      parquetTarget({
        dir,
        tables: [BLOCKS_TABLE],
        settings: { engine: duckdbEngine() },
        onData: ({ store, data }) => {
          store.insert(
            'blocks',
            data.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
          )
        },
      }),
    )

    expect(await listDataFiles(dir, 'blocks')).toEqual(['000000000003-000000000005.parquet'])
    const entries = await readdir(blocksDir)
    expect(entries.some((f) => f.startsWith('.tmp-'))).toBe(false)
  })
})
