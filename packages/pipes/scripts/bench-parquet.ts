#!/usr/bin/env -S pnpm tsx
// Micro-benchmark: single-threaded append + publish throughput per parquet engine.
// Usage (from packages/pipes/): pnpm tsx scripts/bench-parquet.ts [rows]
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ParquetSchema } from '@dsnp/parquetjs'

import { DuckdbSegmentWriter, SegmentSizeEstimator } from '../src/targets/parquet/duckdb-writer.js'
import { buildRowWrapper, toParquetSchemaShape } from '../src/targets/parquet/parquetjs-schema.js'
import { ParquetSegmentWriter } from '../src/targets/parquet/parquetjs-writer.js'
import { type ParquetTable } from '../src/targets/parquet/schema.js'
import type { PublishedSegment } from '../src/targets/parquet/segment.js'

const ROWS = Number(process.argv[2] ?? 200_000)

// BTC-outputs-like shape — the workload whose CPU profile motivated the duckdb engine.
const TABLE: ParquetTable = {
  table: 'outputs',
  schema: {
    blockNumber: { type: 'INT64' },
    txid: { type: 'UTF8' },
    vout: { type: 'INT32' },
    value: { type: 'INT64' },
    scriptType: { type: 'UTF8', optional: true },
    addresses: { type: 'LIST', element: { type: 'UTF8' }, optional: true },
  },
}

function makeRow(i: number) {
  return {
    blockNumber: 500_000 + (i % 500),
    txid: `f${i.toString(16).padStart(63, '0')}`,
    vout: i % 4,
    value: BigInt(1_000 + i),
    scriptType: i % 7 === 0 ? null : 'pubkeyhash',
    addresses: i % 11 === 0 ? [] : [`1Addr${(i % 97).toString().padStart(2, '0')}xxxxxxxxxxxxxxxxxxxxxxxx`],
  }
}

type BenchWriter = {
  appendRow(row: Record<string, unknown>, block: number): Promise<void>
  publish(): Promise<PublishedSegment>
}

async function bench(name: string, writer: BenchWriter): Promise<void> {
  const started = performance.now()
  for (let i = 0; i < ROWS; i++) {
    await writer.appendRow(makeRow(i), 500_000 + (i % 500))
  }
  const appended = performance.now()
  const published = await writer.publish()
  const done = performance.now()

  const appendRate = (ROWS / ((appended - started) / 1000)).toFixed(0)
  console.log(
    `${name.padEnd(10)} append ${appendRate.padStart(8)} rows/s   ` +
      `publish ${((done - appended) / 1000).toFixed(2)}s   ` +
      `file ${(published.bytes / 1024 / 1024).toFixed(1)} MiB`,
  )
}

const base = await mkdtemp(path.join(tmpdir(), 'sqd-parquet-bench-'))
try {
  const dirA = path.join(base, 'parquetjs')
  const dirB = path.join(base, 'duckdb')
  await mkdir(dirA)
  await mkdir(dirB)

  const wrap = buildRowWrapper(TABLE.schema)
  const schema = new ParquetSchema(toParquetSchemaShape(TABLE, 'SNAPPY'))
  const parquetjs = new ParquetSegmentWriter({
    dir: dirA,
    schema: () => Promise.resolve(schema),
    rowGroupSize: 100_000,
  })
  await bench('parquetjs', {
    appendRow: (row, block) => parquetjs.appendRow(wrap ? wrap(row) : row, block),
    publish: () => parquetjs.publish(),
  })

  await bench(
    'duckdb',
    new DuckdbSegmentWriter({
      dir: dirB,
      columns: TABLE.schema,
      rowGroupSize: 100_000,
      codec: 'SNAPPY',
      estimator: new SegmentSizeEstimator(),
    }),
  )
} finally {
  await rm(base, { recursive: true, force: true })
}
