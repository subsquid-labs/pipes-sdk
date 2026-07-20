import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ParquetReader } from '@dsnp/parquetjs'
import { afterEach, describe, expect, it } from 'vitest'

import { duckdbEngine, parquetTarget, parquetjsEngine } from '../../../src/targets/parquet/index.js'
import { type MockPortal, type MockResponse, mockPortal } from '../../../src/testing/index.js'
import { indexers } from './index.js'

type ParquetRow = Record<string, unknown>

async function readParquetRows(tableDir: string): Promise<{ files: string[]; rows: ParquetRow[] }> {
  const files = (await readdir(tableDir)).filter((file) => file.endsWith('.parquet')).sort()
  const rows: ParquetRow[] = []

  for (const file of files) {
    const reader = await ParquetReader.openFile(path.join(tableDir, file))

    try {
      const cursor = reader.getCursor()
      let row: ParquetRow | null
      while ((row = (await cursor.next()) as ParquetRow | null)) rows.push(row)
    } finally {
      await reader.close()
    }
  }

  return { files, rows }
}

describe('bench indexer registry', () => {
  it('exposes all 16 indexers keyed by their own ids', () => {
    const ids = Object.keys(indexers)

    expect(ids).toHaveLength(16)
    for (const [key, indexer] of Object.entries(indexers)) expect(indexer.id).toBe(key)
    expect(ids).toEqual(
      expect.arrayContaining([
        'btc-blocks',
        'btc-transactions',
        'btc-outputs',
        'btc-inputs',
        'ethereum-blocks',
        'ethereum-transactions',
        'ethereum-logs',
        'ethereum-receipts',
        'ethereum-traces',
        'ethereum-token-transfers',
        'ethereum-event-decoder',
        'polygon-blocks',
        'polygon-transactions',
        'polygon-logs',
        'polygon-receipts',
        'polygon-event-decoder',
      ]),
    )
  })

  it('every table is valid under both engines', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bench-registry-'))

    try {
      for (const indexer of Object.values(indexers)) {
        expect(() => parquetTarget({ dir, tables: [indexer.table], onData: () => {} })).not.toThrow()
        expect(() =>
          parquetTarget({ dir, tables: [indexer.table], settings: { engine: duckdbEngine() }, onData: () => {} }),
        ).not.toThrow()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('offline full pipeline (ethereum-logs, both engines)', () => {
  const address = `0x${'aa'.repeat(20)}`
  const topic = `0x${'bb'.repeat(32)}`
  let portal: MockPortal | undefined
  let dir: string | undefined

  function blockHash(n: number): string {
    return `0x${n.toString(16).padStart(64, '0')}`
  }

  function transactionHash(n: number): string {
    return `0x${(n + 10).toString(16).padStart(64, '0')}`
  }

  afterEach(async () => {
    await portal?.close()
    portal = undefined
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = undefined
  })

  function logsResponse(): MockResponse {
    const blocks = [1, 2, 3].map((n) => ({
      header: { number: n, hash: blockHash(n), timestamp: 1_730_000_000 + n },
      logs: [
        {
          logIndex: 0,
          transactionIndex: 0,
          transactionHash: transactionHash(n),
          address,
          data: '0x01',
          topics: [topic],
        },
      ],
    }))

    return { statusCode: 200, data: blocks, head: { finalized: { number: 3, hash: blockHash(3) } } }
  }

  for (const engineName of ['parquetjs', 'duckdb'] as const) {
    it(`writes and reads all mapped rows through parquetTarget with engine ${engineName}`, async () => {
      dir = await mkdtemp(path.join(tmpdir(), `bench-e2e-${engineName}-`))
      portal = await mockPortal([logsResponse()])
      const indexer = indexers['ethereum-logs']
      const engine = engineName === 'duckdb' ? duckdbEngine() : parquetjsEngine()

      let callbackRows = 0
      await indexer.createStream({ portal: portal.url, range: { from: 1, to: 3 } }).pipeTo(
        parquetTarget({
          dir,
          tables: [indexer.table],
          settings: { engine },
          onData: ({ store, data }) => {
            callbackRows += data.length
            store.insert(indexer.table.table, data)
          },
        }),
      )

      expect(callbackRows).toBe(3)
      const { files, rows } = await readParquetRows(path.join(dir, 'logs'))
      expect(files.length).toBeGreaterThan(0)
      expect(rows).toHaveLength(3)
      rows.sort((left, right) => Number(left['block_number']) - Number(right['block_number']))

      for (const [index, row] of rows.entries()) {
        const n = index + 1
        expect(row['block_number']).toBe(BigInt(n))
        expect(row['block_hash']).toBe(blockHash(n))
        expect(row['block_timestamp']).toEqual(new Date((1_730_000_000 + n) * 1000))
        expect(row['transaction_hash']).toBe(transactionHash(n))
        expect(row['transaction_index']).toBe(BigInt(0))
        expect(row['log_index']).toBe(BigInt(0))
        expect(row['address']).toBe(address)
        expect(row['data']).toBe('0x01')
        expect(row['topics']).toEqual({ list: [{ element: topic }] })
        expect(row['removed']).toBe(false)
      }
    })
  }
})
