#!/usr/bin/env -S pnpm tsx
// Deep engine micro-benchmark: runs ONE (engine, schema, rows, codec, threads) configuration
// in a fresh process — K sequential segments, one JSON line per segment on stdout — so
// cross-engine warmup/ordering contamination is impossible. An external driver iterates the
// matrix and an aggregator computes medians. Manual tool; not part of CI.
//
// Metrics per segment (all fair to both engines):
//   appendMs / publishMs / totalMs   wall-clock phases
//   rowsPerSec                       append-phase throughput
//   eluAppendMs / eluPublishMs /     event-loop ACTIVE time (perf_hooks ELU) — the JS
//   mainThreadMs                     main-thread occupancy; duckdb's COPY await is idle time
//   cpuTotalMs                       process CPU incl. DuckDB native worker threads
//   maxStallMs / stallsOver10        worst single appendRow call — pipeline pause behavior
//   fileMB / rssAppendMB / rssMB     output size, RSS at append-end (staging peak) and publish-end
//
// The parquetjs path applies buildRowWrapper per row (as ParquetStore does in production);
// the duckdb path takes plain rows. Rows come from a frozen 10k pool cycled per segment
// (generation cost excluded; pooled objects are never mutated so buffering by reference is
// safe). Block ranges are disjoint per segment so publishes never collide.
//
// Usage (from packages/pipes/):
//   pnpm tsx scripts/bench-parquet-deep.ts --engine duckdb --schema btc_outputs \
//     --rows 100000 --codec SNAPPY --threads 2 --segments 4 --rep 1
import { mkdtemp, rm } from 'node:fs/promises'
import { cpus, tmpdir, totalmem } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { ParquetSchema } from '@dsnp/parquetjs'

import { acquireDuckdbInstance, loadDuckdbApi } from '../src/targets/parquet/duckdb-engine.js'
import { DuckdbSegmentWriter, SegmentSizeEstimator } from '../src/targets/parquet/duckdb-writer.js'
import { buildRowWrapper, toParquetSchemaShape } from '../src/targets/parquet/parquetjs-schema.js'
import { type Codec, type ParquetColumns, type ParquetTable } from '../src/targets/parquet/schema.js'
import type { SegmentWriter } from '../src/targets/parquet/segment.js'
import { ParquetSegmentWriter } from '../src/targets/parquet/writer.js'

type Row = Record<string, unknown>

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`)
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1]
  if (fallback !== undefined) return fallback
  throw new Error(`missing --${name}`)
}

const ENGINE = arg('engine')
const SCHEMA_NAME = arg('schema')
const ROWS = Number(arg('rows'))
const CODEC = arg('codec', 'SNAPPY') as Codec
const THREADS = Number(arg('threads', '2'))
const SEGMENTS = Number(arg('segments', '4'))
const REP = Number(arg('rep', '1'))
const ROW_GROUP_SIZE = 100_000 // SDK default (parquet-target.ts DEFAULT_ROW_GROUP_SIZE)
const POOL_SIZE = Math.min(ROWS, 10_000)

// ---------- workload schemas: shape + deterministic row generator ----------

const wideSchema: ParquetColumns = { blockNumber: { type: 'INT64' } }
for (let c = 0; c < 8; c++) wideSchema[`i${c}`] = { type: 'INT64' }
for (let c = 0; c < 8; c++) wideSchema[`s${c}`] = { type: 'UTF8' }
for (let c = 0; c < 4; c++) wideSchema[`d${c}`] = { type: 'DOUBLE' }
for (let c = 0; c < 4; c++) wideSchema[`b${c}`] = { type: 'BOOLEAN' }

const SCHEMAS: Record<string, { table: ParquetTable; makeRow: (i: number) => Row }> = {
  // Per-row overhead floor: 3 scalar columns, numbers only.
  flat_narrow: {
    table: {
      table: 'flat_narrow',
      schema: { blockNumber: { type: 'INT64' }, value: { type: 'INT64' }, flag: { type: 'BOOLEAN' } },
    },
    makeRow: (i) => ({ blockNumber: 500_000 + (i % 500), value: 1_000 + i, flag: i % 3 === 0 }),
  },

  // The production-motivating workload — same shape as scripts/bench-parquet.ts.
  btc_outputs: {
    table: {
      table: 'outputs',
      schema: {
        blockNumber: { type: 'INT64' },
        txid: { type: 'UTF8' },
        vout: { type: 'INT32' },
        value: { type: 'INT64' },
        scriptType: { type: 'UTF8', optional: true },
        addresses: { type: 'LIST', element: { type: 'UTF8' }, optional: true },
      },
    },
    makeRow: (i) => ({
      blockNumber: 500_000 + (i % 500),
      txid: `f${i.toString(16).padStart(63, '0')}`,
      vout: i % 4,
      value: BigInt(1_000 + i),
      scriptType: i % 7 === 0 ? null : 'pubkeyhash',
      addresses: i % 11 === 0 ? [] : [`1Addr${(i % 97).toString().padStart(2, '0')}xxxxxxxxxxxxxxxxxxxxxxxx`],
    }),
  },

  // Many scalar cells per row: 25 columns = 25 typed appender FFI calls/row under duckdb.
  wide_flat: {
    table: { table: 'wide_flat', schema: wideSchema },
    makeRow: (i) => {
      const row: Row = { blockNumber: 500_000 + (i % 500) }
      for (let c = 0; c < 8; c++) row[`i${c}`] = i * 8 + c
      for (let c = 0; c < 8; c++) row[`s${c}`] = `v${c}-${(i % 1000).toString().padStart(8, '0')}`
      for (let c = 0; c < 4; c++) row[`d${c}`] = i * 1.5 + c * 0.25
      for (let c = 0; c < 4; c++) row[`b${c}`] = ((i >> c) & 1) === 1
      return row
    },
  },

  // String copy cost: 4 × 128-char strings per row.
  string_heavy: {
    table: {
      table: 'string_heavy',
      schema: {
        blockNumber: { type: 'INT64' },
        a: { type: 'UTF8' },
        b: { type: 'UTF8' },
        c: { type: 'UTF8' },
        d: { type: 'UTF8' },
      },
    },
    makeRow: (i) => {
      const tail = i.toString(16).padStart(64, '0')
      return {
        blockNumber: 500_000 + (i % 500),
        a: `${'ab'.repeat(32)}${tail}`,
        b: `${'cd'.repeat(32)}${tail}`,
        c: `${'ef'.repeat(32)}${tail}`,
        d: `${'01'.repeat(32)}${tail}`,
      }
    },
  },

  // Nested encoders: LIST<STRUCT>×5 + JSON + LIST<LIST> + nullable LIST — stresses
  // DuckDBValue tree building (duckdb) vs wrapRow + JS shredding (parquetjs).
  nested_heavy: {
    table: {
      table: 'nested_heavy',
      schema: {
        blockNumber: { type: 'INT64' },
        xfers: {
          type: 'LIST',
          element: { type: 'STRUCT', fields: { to: { type: 'UTF8' }, amt: { type: 'INT64' } } },
        },
        tags: { type: 'LIST', element: { type: 'UTF8', optional: true }, optional: true },
        meta: { type: 'JSON', optional: true },
        matrix: { type: 'LIST', element: { type: 'LIST', element: { type: 'INT32' } } },
      },
    },
    makeRow: (i) => ({
      blockNumber: 500_000 + (i % 500),
      xfers: [0, 1, 2, 3, 4].map((k) => ({
        to: `0x${(i + k).toString(16).padStart(40, '0')}`,
        amt: BigInt(i * 10 + k),
      })),
      tags: i % 5 === 0 ? ['hot', null, 'seen'] : ['cold'],
      meta: i % 4 === 0 ? null : { fee: i % 100, keys: [`k${i % 10}`, `v${i % 7}`] },
      matrix: [
        [i % 10, (i + 1) % 10, (i + 2) % 10],
        [(i + 3) % 10, (i + 4) % 10],
      ],
    }),
  },
}

// ---------- run ----------

const spec = SCHEMAS[SCHEMA_NAME]
if (!spec) throw new Error(`unknown schema '${SCHEMA_NAME}' (have: ${Object.keys(SCHEMAS).join(', ')})`)
if (ENGINE !== 'parquetjs' && ENGINE !== 'duckdb') throw new Error(`unknown engine '${ENGINE}'`)

const round1 = (x: number) => +x.toFixed(1)

// Frozen row pool — built once, NEVER mutated (parquetjs buffers rows by reference).
const pool: Row[] = []
for (let i = 0; i < POOL_SIZE; i++) pool.push(spec.makeRow(i))

const dir = await mkdtemp(path.join(tmpdir(), 'sqd-bench-deep-'))

// Setup that production amortizes once per process/table: engine module + instance for
// duckdb, ParquetSchema + row wrapper for parquetjs. Excluded from segment timings.
const setupStart = performance.now()
const wrap = ENGINE === 'parquetjs' ? buildRowWrapper(spec.table.schema) : undefined
let makeWriter: () => SegmentWriter
if (ENGINE === 'duckdb') {
  await loadDuckdbApi()
  await acquireDuckdbInstance({ threads: THREADS, memoryLimit: '2GB' })
  const estimator = new SegmentSizeEstimator()
  makeWriter = () =>
    new DuckdbSegmentWriter({
      dir,
      columns: spec.table.schema,
      rowGroupSize: ROW_GROUP_SIZE,
      codec: CODEC,
      duckdb: { threads: THREADS, memoryLimit: '2GB' },
      estimator,
    })
} else {
  const schema = new ParquetSchema(toParquetSchemaShape(spec.table, CODEC))
  makeWriter = () => new ParquetSegmentWriter({ dir, schema, rowGroupSize: ROW_GROUP_SIZE })
}
const setupMs = performance.now() - setupStart

console.log(
  JSON.stringify({
    type: 'meta',
    engine: ENGINE,
    schema: SCHEMA_NAME,
    rows: ROWS,
    codec: CODEC,
    threads: THREADS,
    rep: REP,
    segments: SEGMENTS,
    rowGroupSize: ROW_GROUP_SIZE,
    poolSize: POOL_SIZE,
    setupMs: round1(setupMs),
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memGB: Math.round(totalmem() / 2 ** 30),
    platform: process.platform,
    arch: process.arch,
  }),
)

for (let seg = 0; seg < SEGMENTS; seg++) {
  const base = 1_000_000 * (seg + 1) // disjoint block ranges → no publish collisions
  const writer = makeWriter()

  const cpu0 = process.cpuUsage()
  const elu0 = performance.eventLoopUtilization()
  let maxStallMs = 0
  let stallsOver10 = 0

  const t0 = performance.now()
  for (let i = 0; i < ROWS; i++) {
    const row = pool[i % POOL_SIZE]
    const s = performance.now()
    await writer.appendRow(wrap ? wrap(row) : row, base + i)
    const d = performance.now() - s
    if (d > maxStallMs) maxStallMs = d
    if (d > 10) stallsOver10++
  }
  const t1 = performance.now()

  // Diagnostic mode (BENCH_GC=1 + NODE_OPTIONS=--expose-gc): force a full GC between the
  // append and publish phases so allocation debt from append is charged to neither phase's
  // ELU — separates "publish is busy doing client flush/COPY work" from "publish is busy
  // collecting append's garbage".
  const gcMs = (() => {
    if (process.env.BENCH_GC !== '1' || typeof globalThis.gc !== 'function') return 0
    const s = performance.now()
    globalThis.gc()
    return performance.now() - s
  })()

  const elu1 = performance.eventLoopUtilization()
  const cpu1 = process.cpuUsage()
  const rssAppend = process.memoryUsage().rss

  const tPub = performance.now()
  const published = await writer.publish()
  const t2 = performance.now()
  const elu2 = performance.eventLoopUtilization()
  const cpu2 = process.cpuUsage()
  const rssEnd = process.memoryUsage().rss

  console.log(
    JSON.stringify({
      type: 'segment',
      engine: ENGINE,
      schema: SCHEMA_NAME,
      rows: ROWS,
      codec: CODEC,
      threads: THREADS,
      rep: REP,
      seg,
      appendMs: round1(t1 - t0),
      publishMs: round1(t2 - tPub),
      totalMs: round1(t2 - t0 - gcMs),
      rowsPerSec: Math.round(ROWS / ((t1 - t0) / 1000)),
      eluAppendMs: round1(elu1.active - elu0.active),
      eluPublishMs: round1(elu2.active - elu1.active),
      mainThreadMs: round1(elu2.active - elu0.active),
      cpuTotalMs: round1((cpu2.user - cpu0.user + cpu2.system - cpu0.system) / 1000),
      maxStallMs: round1(maxStallMs),
      stallsOver10,
      gcMs: round1(gcMs),
      fileMB: +(published.bytes / 2 ** 20).toFixed(2),
      rssAppendMB: Math.round(rssAppend / 2 ** 20),
      rssMB: Math.round(rssEnd / 2 ** 20),
    }),
  )
}

await rm(dir, { recursive: true, force: true })
