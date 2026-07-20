import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ParquetReader } from '@dsnp/parquetjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ParquetColumns, ParquetTable } from '../schema.js'
import { acquireDuckdbInstance } from './duckdb-engine.js'
import { DuckdbSegmentWriter, SegmentSizeEstimator, duckdbEngine } from './duckdb-writer.js'

const COLUMNS: ParquetColumns = { blockNumber: { type: 'INT64' } }

function makeWriter(dir: string, estimator = new SegmentSizeEstimator()) {
  return new DuckdbSegmentWriter({
    dir,
    columns: COLUMNS,
    rowGroupSize: 100_000,
    codec: 'SNAPPY',
    estimator,
  })
}

/** Segment staging tables left in the shared (default-config) instance. Must always drain to 0. */
async function countStagingTables(): Promise<number> {
  const instance = await acquireDuckdbInstance()
  const connection = await instance.connect()
  try {
    const result = await connection.runAndReadAll(
      "SELECT count(*) AS n FROM duckdb_tables() WHERE table_name LIKE 'seg_%'",
    )

    return Number((result.getRowObjects()[0] as { n: bigint }).n)
  } finally {
    connection.disconnectSync()
  }
}

describe('DuckdbSegmentWriter', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-duckdb-writer-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('lazy-opens, tracks range/rowCount, publishes <min>-<max> and drops its staging table', async () => {
    const writer = makeWriter(dir)
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
    expect(writer.isOpen).toBe(false)
    expect(await countStagingTables()).toBe(0)

    // Cross-reader compatibility: the parquetjs engine's reader consumes the DuckDB file.
    const reader = await ParquetReader.openFile(published.path)
    const cursor = reader.getCursor()
    const rows: unknown[] = []
    let row: unknown
    while ((row = await cursor.next())) rows.push(row)
    await reader.close()
    expect(rows).toEqual([{ blockNumber: 5n }, { blockNumber: 8n }])
  })

  it('refuses to overwrite an existing file (collision), and discard() cleans up after it', async () => {
    const first = makeWriter(dir)
    await first.appendRow({ blockNumber: 1 }, 1)
    await first.publish()

    const second = makeWriter(dir)
    await second.appendRow({ blockNumber: 1 }, 1)
    await expect(second.publish()).rejects.toThrowError(/Refusing to overwrite/)

    await second.discard()
    expect((await readdir(dir)).filter((f) => f.startsWith('.tmp-'))).toEqual([])
    expect(await countStagingTables()).toBe(0)
  })

  it('publish() on an empty segment throws', async () => {
    const writer = makeWriter(dir)

    await expect(writer.publish()).rejects.toThrowError(/empty segment/)
  })

  it('discard() drops the staging table, removes the temp file and is safe to call twice', async () => {
    const writer = makeWriter(dir)
    await writer.appendRow({ blockNumber: 1 }, 1)
    await writer.discard()
    await writer.discard()

    expect((await readdir(dir)).filter((f) => f.startsWith('.tmp-'))).toEqual([])
    expect(await countStagingTables()).toBe(0)
  })

  it('size() estimates from rowCount and calibrates from the previous published segment', async () => {
    const estimator = new SegmentSizeEstimator()
    const first = makeWriter(dir, estimator)
    for (let block = 1; block <= 100; block++) await first.appendRow({ blockNumber: block }, block)
    expect(await first.size()).toBe(estimator.estimate(100))

    const published = await first.publish()

    // The next segment for the same table starts from measured bytes/row, not the default.
    const second = makeWriter(dir, estimator)
    await second.appendRow({ blockNumber: 101 }, 101)
    expect(await second.size()).toBe(Math.ceil(published.bytes / published.rows))
    await second.discard()
  })
})

describe('duckdbEngine', () => {
  const BLOCKS: ParquetTable = {
    table: 'blocks',
    schema: { blockNumber: { type: 'INT64' }, hash: { type: 'UTF8' } },
  }

  it('exposes its name and resolved settings', () => {
    expect(duckdbEngine().name).toBe('duckdb')
    expect(duckdbEngine().settings).toEqual({ threads: 2, memoryLimit: '2GB' })
    expect(duckdbEngine({ threads: 4 }).settings).toEqual({ threads: 4, memoryLimit: '2GB' })
  })

  it('rejects per-column compression differing from the file codec at table() time', () => {
    const table: ParquetTable = {
      table: 't',
      schema: { blockNumber: { type: 'INT64' }, data: { type: 'UTF8', compression: 'GZIP' } },
    }

    expect(() => duckdbEngine().table(table, { dir: '/unused', rowGroupSize: 10, codec: 'SNAPPY' })).toThrow(
      /per-column compression/,
    )
  })

  it('carries bytes-per-row calibration across successive segments', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sqd-duckdb-engine-test-'))
    try {
      const tableWriter = duckdbEngine().table(BLOCKS, { dir, rowGroupSize: 100, codec: 'SNAPPY' })

      const first = tableWriter.createSegment()
      for (let n = 1; n <= 50; n++) await first.appendRow({ blockNumber: n, hash: `0x${n}` }, n)
      const published = await first.publish()

      const second = tableWriter.createSegment()
      await second.appendRow({ blockNumber: 100, hash: '0x100' }, 100)
      // The estimate reflects the first segment's real bytes/row, not the 512-byte default.
      expect(await second.size()).toBe(Math.ceil(published.bytes / published.rows))
      await second.discard()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
