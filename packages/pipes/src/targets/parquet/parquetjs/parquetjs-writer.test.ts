import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ParquetReader } from '@dsnp/parquetjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ParquetTable } from '../schema.js'
import { parquetjsEngine } from './parquetjs-engine.js'

const TRANSFERS: ParquetTable = {
  table: 'transfers',
  schema: {
    blockNumber: { type: 'INT64' },
    to: { type: 'UTF8' },
    tags: { type: 'LIST', element: { type: 'UTF8' } },
  },
}

async function readAllRows(file: string): Promise<Record<string, unknown>[]> {
  const reader = await ParquetReader.openFile(file)
  const cursor = reader.getCursor()
  const rows: Record<string, unknown>[] = []
  let row: Record<string, unknown> | null
  while ((row = (await cursor.next()) as Record<string, unknown> | null)) rows.push(row)
  await reader.close()

  return rows
}

describe('parquetjsEngine', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-parquetjs-engine-test-'))
    await mkdir(path.join(dir, 'transfers'), { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips plain rows (LIST cells as plain arrays) through a finished segment', async () => {
    const engine = parquetjsEngine({ rowGroupSize: 100 })
    expect(engine.name).toBe('parquetjs')

    const tableWriter = engine.table(TRANSFERS)

    const tmpPath = path.join(dir, 'transfers', '.tmp-000000.parquet')
    const writer = tableWriter.createSegment(tmpPath)
    await writer.append([
      { blockNumber: 1, to: '0xa', tags: ['x', 'y'] },
      { blockNumber: 2, to: '0xb', tags: ['z'] },
    ])
    await writer.finish()

    // The engine wrote a complete Parquet file exactly at the target-assigned temp path.
    const rows = await readAllRows(tmpPath)
    expect(rows.map((r) => [r['blockNumber'], r['to']])).toEqual([
      [1n, '0xa'],
      [2n, '0xb'],
    ])
    // Plain array in, spec-canonical 3-level LIST layout on disk — the wrapping happened
    // inside the engine, not in the caller.
    expect(rows[0]?.['tags']).toEqual({ list: [{ element: 'x' }, { element: 'y' }] })
  })

  it('finish() with no appended rows still writes a real, readable schema-only file', async () => {
    // Tail closing claims a window a table produced nothing in — the zero-row contract.
    const tableWriter = parquetjsEngine({ rowGroupSize: 100 }).table(TRANSFERS)

    const tmpPath = path.join(dir, 'transfers', '.tmp-empty.parquet')
    const writer = tableWriter.createSegment(tmpPath)
    await writer.finish()

    const reader = await ParquetReader.openFile(tmpPath)
    expect(Number(reader.getRowCount())).toBe(0)
    expect(reader.getSchema().fieldList.length).toBeGreaterThan(0)
    await reader.close()
  })

  it('reuses the compiled library schema across successive segments', async () => {
    const tableWriter = parquetjsEngine({ rowGroupSize: 100 }).table(TRANSFERS)

    const firstPath = path.join(dir, 'transfers', '.tmp-first.parquet')
    const first = tableWriter.createSegment(firstPath)
    await first.append([{ blockNumber: 1, to: '0xa', tags: [] }])
    await first.finish()

    const secondPath = path.join(dir, 'transfers', '.tmp-second.parquet')
    const second = tableWriter.createSegment(secondPath)
    await second.append([{ blockNumber: 2, to: '0xb', tags: [] }])
    await second.finish()

    expect((await readAllRows(firstPath)).length).toBe(1)
    expect((await readAllRows(secondPath)).length).toBe(1)
  })
})
