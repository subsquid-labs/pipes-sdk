import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { duckdbEngine } from '../../../../../../packages/pipes/src/targets/parquet/duckdb/index.js'
import { parquetTarget } from '../../../../../../packages/pipes/src/targets/parquet/index.js'
import { btcBlocks, mapBlocks } from './blocks.js'

const HEADER = {
  number: 895_000,
  hash: '00000000000000000000a1b2',
  timestamp: 1_747_749_600, // 2025-05-20T14:00:00Z
  version: 536870912,
  merkleRoot: 'ab12',
  nonce: 3735928559,
  bits: '17023b3c',
  strippedSize: 800_123,
  size: 1_500_456,
  weight: 3_900_000,
}

describe('btc-blocks', () => {
  it('maps a portal block to the gfs blocks row shape', () => {
    const rows = mapBlocks([
      {
        header: HEADER,
        transactions: [{ transactionIndex: 0 }, { transactionIndex: 1 }],
        inputs: [{ transactionIndex: 0, inputIndex: 0, coinbase: '03abcd' }],
      },
    ])

    expect(rows).toEqual([
      {
        hash: HEADER.hash,
        size: 1_500_456,
        stripped_size: 800_123,
        weight: 3_900_000,
        number: 895_000,
        version: 536870912,
        merkle_root: 'ab12',
        timestamp: 1_747_749_600_000,
        timestamp_month: new Date(Date.UTC(2025, 4, 1)),
        nonce: 'deadbeef',
        bits: '17023b3c',
        coinbase_param: '03abcd',
        transaction_count: 2,
      },
    ])
  })

  it('throws when nonce is missing (gfs invariant)', () => {
    expect(() => mapBlocks([{ header: { ...HEADER, nonce: null }, transactions: [], inputs: [] }])).toThrow(/nonce/)
  })

  it('declares a parquet table valid under both engines', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'bench-btc-blocks-'))

    try {
      expect(() => parquetTarget({ dir, tables: [btcBlocks.table], onData: () => {} })).not.toThrow()
      expect(() =>
        parquetTarget({ dir, tables: [btcBlocks.table], settings: { engine: duckdbEngine() }, onData: () => {} }),
      ).not.toThrow()
      expect(btcBlocks.table.blockNumberColumn).toBe('number')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
