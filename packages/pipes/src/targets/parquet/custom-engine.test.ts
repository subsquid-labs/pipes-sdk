import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evmPortalStream } from '~/evm/index.js'
import { type MockPortal, type MockResponse, blockDecoder, mockPortal } from '~/testing/index.js'

import type { ParquetEngine } from './engine.js'
import { parquetTarget } from './parquet-target.js'

/**
 * A minimal third-party engine built ONLY from the public extension surface: it buffers rows in
 * memory and writes them as JSON wrapped in the Parquet magic bytes at the target-assigned temp
 * path. (A real engine must write actual Parquet — the magic-byte wrapper keeps this test
 * dependency-free while passing the target's output verification, so it still exercises
 * target-owned naming, publication and cursor persistence end to end.)
 */
function jsonEngine(calls: string[]): ParquetEngine {
  return {
    name: 'json-test',
    table(table, context) {
      calls.push(`table:${table.table}:rowGroupSize=${context.rowGroupSize}:compression=${context.defaultCompression}`)

      return {
        createSegment(tmpPath) {
          const rows: Record<string, unknown>[] = []

          return {
            async append(batch) {
              rows.push(...batch)
            },
            async size() {
              return JSON.stringify(rows).length
            },
            async finish() {
              // A zero-row finish is part of the contract (tail closing) and still writes a file.
              await writeFile(tmpPath, `PAR1${JSON.stringify(rows)}PAR1`)
            },
            async abort() {
              rows.length = 0
            },
          }
        },
      }
    },
  }
}

/** An engine that ignores the output contract: its finished file is not Parquet. */
function brokenEngine(): ParquetEngine {
  return {
    name: 'broken-test',
    table() {
      return {
        createSegment(tmpPath) {
          const rows: Record<string, unknown>[] = []

          return {
            async append(batch) {
              rows.push(...batch)
            },
            async size() {
              return JSON.stringify(rows).length
            },
            async finish() {
              await writeFile(tmpPath, JSON.stringify(rows))
            },
            async abort() {},
          }
        },
      }
    },
  }
}

function blocksResponse(numbers: number[], finalized?: number): MockResponse {
  return {
    statusCode: 200,
    data: numbers.map((n) => ({ header: { number: n, hash: `0x${n}`, timestamp: n * 1000 } })),
    head: finalized === undefined ? undefined : { finalized: { number: finalized, hash: `0x${finalized}` } },
  }
}

describe('parquetTarget with a custom engine', () => {
  let portal: MockPortal | undefined
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-parquet-custom-engine-test-'))
  })

  afterEach(async () => {
    await portal?.close()
    portal = undefined
    await rm(dir, { recursive: true, force: true })
  })

  it('drives a from-scratch engine through finalization, publish and cursor persistence', async () => {
    portal = await mockPortal([blocksResponse([1, 2, 3, 4, 5], 3)])
    const calls: string[] = []

    await evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 5 }) }).pipeTo(
      parquetTarget({
        dir,
        tables: [
          {
            table: 'blocks',
            schema: { blockNumber: { type: 'INT64' }, hash: { type: 'UTF8' } },
          },
        ],
        settings: { engine: jsonEngine(calls) },
        onData: ({ store, data }) => {
          store.insert(
            'blocks',
            data.map((b) => ({ blockNumber: b.number, hash: b.hash })),
          )
        },
      }),
    )

    // table() received the declared table plus resolved defaults, once, at construction.
    expect(calls).toEqual(['table:blocks:rowGroupSize=100000:compression=SNAPPY'])

    // Only the finalized rows (1-3) published; the file is named by the target for the coverage
    // window — from the configured start (0) to the finalized boundary (3). The engine never saw
    // the window or chose the name.
    const files = (await readdir(path.join(dir, 'blocks'))).sort()
    expect(files).toEqual(['000000000000-000000000003.parquet'])

    // Rows arrived in the engine-neutral plain shape, in order.
    const raw = await readFile(path.join(dir, 'blocks', files[0]!), 'utf8')
    const content = JSON.parse(raw.slice(4, -4))
    expect(content).toEqual([
      { blockNumber: 1, hash: '0x1' },
      { blockNumber: 2, hash: '0x2' },
      { blockNumber: 3, hash: '0x3' },
    ])

    // The checkpoint that published the segment also persisted the cursor.
    const stateFiles = (await readdir(dir)).filter((f) => f.startsWith('_sqd_parquet_state.'))
    expect(stateFiles).toHaveLength(1)
  })

  it('refuses to publish an engine output that is not a Parquet file', async () => {
    portal = await mockPortal([blocksResponse([1, 2, 3], 3)])

    await expect(
      evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 3 }) }).pipeTo(
        parquetTarget({
          dir,
          tables: [{ table: 'blocks', schema: { blockNumber: { type: 'INT64' } } }],
          settings: { engine: brokenEngine() },
          onData: ({ store, data }) => {
            store.insert(
              'blocks',
              data.map((b) => ({ blockNumber: b.number })),
            )
          },
        }),
      ),
    ).rejects.toThrowError(/Parquet magic bytes/)

    // Nothing was published, the temp file was cleaned up, and no cursor was persisted —
    // the run is fully recoverable.
    expect(await readdir(path.join(dir, 'blocks'))).toEqual([])
    expect((await readdir(dir)).filter((f) => f.startsWith('_sqd_parquet_state.'))).toEqual([])
  })
})
