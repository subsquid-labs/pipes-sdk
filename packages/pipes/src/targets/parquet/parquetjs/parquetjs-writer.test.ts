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

  it('round-trips plain rows (LIST cells as plain arrays) through a published segment', async () => {
    const engine = parquetjsEngine()
    expect(engine.name).toBe('parquetjs')

    const tableDir = path.join(dir, 'transfers')
    const tableWriter = engine.table(TRANSFERS, { dir: tableDir, rowGroupSize: 100, codec: 'SNAPPY' })

    const writer = tableWriter.createSegment()
    await writer.appendRow({ blockNumber: 1, to: '0xa', tags: ['x', 'y'] }, 1)
    await writer.appendRow({ blockNumber: 2, to: '0xb', tags: ['z'] }, 2)
    const published = await writer.publish()

    expect(published.path).toBe(path.join(tableDir, '000000000001-000000000002.parquet'))
    expect(published.rows).toBe(2)

    const rows = await readAllRows(published.path)
    expect(rows.map((r) => [r['blockNumber'], r['to']])).toEqual([
      [1n, '0xa'],
      [2n, '0xb'],
    ])
    // Plain array in, spec-canonical 3-level LIST layout on disk — the wrapping happened
    // inside the engine, not in the caller.
    expect(rows[0]?.['tags']).toEqual({ list: [{ element: 'x' }, { element: 'y' }] })
  })

  it('reuses the compiled library schema across successive segments', async () => {
    const tableDir = path.join(dir, 'transfers')
    const tableWriter = parquetjsEngine().table(TRANSFERS, { dir: tableDir, rowGroupSize: 100, codec: 'SNAPPY' })

    const first = tableWriter.createSegment()
    await first.appendRow({ blockNumber: 1, to: '0xa', tags: [] }, 1)
    await first.publish()

    const second = tableWriter.createSegment()
    await second.appendRow({ blockNumber: 2, to: '0xb', tags: [] }, 2)
    const published = await second.publish()

    expect(published.path).toBe(path.join(tableDir, '000000000002-000000000002.parquet'))
    expect((await readAllRows(published.path)).length).toBe(1)
  })
})
