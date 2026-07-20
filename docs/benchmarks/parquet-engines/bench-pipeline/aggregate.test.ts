import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  type AggregateDependencies,
  type RunRecord,
  aggregate,
  aggregateMain,
  isDirectInvocation,
  parseAggregateArgs,
  renderMarkdown,
  runAggregateCli,
} from './aggregate.js'

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    indexer: 'btc-outputs',
    engine: 'parquetjs',
    rep: 1,
    range: { from: 10, to: 20 },
    rows: 1_000,
    batches: 10,
    wallMs: 1_000,
    rowsPerSec: 1_000,
    mainThreadMs: 800,
    cpuMs: 900,
    maxStallMs: 50,
    p99StallMs: 25,
    peakRssMB: 300,
    files: 2,
    fileMB: 10,
    node: 'v22.23.1',
    ...overrides,
  }
}

function pair(overrides: Partial<RunRecord> = {}): RunRecord[] {
  const parquetjs = record(overrides)

  return [parquetjs, record({ ...overrides, engine: 'duckdb' })]
}

describe('aggregate', () => {
  it('computes every numeric result median per indexer and engine', () => {
    const records = [
      record({ rep: 1, wallMs: 1_000, batches: 1, p99StallMs: 30, files: 1 }),
      record({ rep: 2, wallMs: 3_000, batches: 3, p99StallMs: 50, files: 3 }),
      record({ rep: 3, wallMs: 2_000, batches: 2, p99StallMs: 40, files: 2 }),
      record({ engine: 'duckdb', rep: 1, wallMs: 500, batches: 4, p99StallMs: 10, files: 4 }),
      record({ engine: 'duckdb', rep: 2, wallMs: 700, batches: 6, p99StallMs: 30, files: 6 }),
      record({ engine: 'duckdb', rep: 3, wallMs: 600, batches: 5, p99StallMs: 20, files: 5 }),
    ]

    const summary = aggregate(records)

    expect(summary.get('btc-outputs')?.get('parquetjs')).toMatchObject({
      runs: 3,
      rows: 1_000,
      batches: 2,
      wallMs: 2_000,
      rowsPerSec: 1_000,
      mainThreadMs: 800,
      cpuMs: 900,
      maxStallMs: 50,
      p99StallMs: 40,
      peakRssMB: 300,
      files: 2,
      fileMB: 10,
    })
    expect(summary.get('btc-outputs')?.get('duckdb')).toMatchObject({
      runs: 3,
      batches: 5,
      wallMs: 600,
      p99StallMs: 20,
      files: 5,
    })
  })

  it('averages the two middle values for an even run count', () => {
    const summary = aggregate([
      record({ rep: 1, wallMs: 1_000 }),
      record({ rep: 2, wallMs: 3_000 }),
      record({ engine: 'duckdb', rep: 1, wallMs: 500 }),
      record({ engine: 'duckdb', rep: 2, wallMs: 700 }),
    ])

    expect(summary.get('btc-outputs')?.get('parquetjs')?.wallMs).toBe(2_000)
    expect(summary.get('btc-outputs')?.get('duckdb')?.wallMs).toBe(600)
  })

  it('renders indexers and engines deterministically with ratio rows', () => {
    const markdown = renderMarkdown(
      aggregate([
        ...pair({ indexer: 'zeta', wallMs: 2_000, mainThreadMs: 1_000 }),
        record({ indexer: 'alpha', wallMs: 2_000, mainThreadMs: 1_000 }),
        record({ indexer: 'alpha', engine: 'duckdb', wallMs: 1_000, mainThreadMs: 500 }),
      ]),
    )
    const rows = markdown.split('\n').slice(2)

    expect(
      rows.map((row) =>
        row
          .split('|')
          .slice(1, 3)
          .map((cell) => cell.trim()),
      ),
    ).toEqual([
      ['alpha', 'parquetjs'],
      ['alpha', 'duckdb'],
      ['alpha', 'duckdb vs parquetjs'],
      ['zeta', 'parquetjs'],
      ['zeta', 'duckdb'],
      ['zeta', 'duckdb vs parquetjs'],
    ])
    expect(markdown).toContain('2.00×')
  })

  it('renders a safe placeholder for zero ratio denominators', () => {
    const markdown = renderMarkdown(
      aggregate([
        record({ wallMs: 0, rowsPerSec: 0, mainThreadMs: 0, cpuMs: 0 }),
        record({ engine: 'duckdb', wallMs: 0, rowsPerSec: 0, mainThreadMs: 0, cpuMs: 0 }),
      ]),
    )

    expect(markdown).not.toMatch(/(?:Infinity|NaN)×/)
    expect(markdown.split('\n').at(-1)).toContain('| — | — | — | — |')
  })

  it('renders a safe placeholder when finite inputs produce a non-finite ratio', () => {
    const markdown = renderMarkdown(
      aggregate([record({ wallMs: Number.MAX_SAFE_INTEGER }), record({ engine: 'duckdb', wallMs: Number.MIN_VALUE })]),
    )

    expect(markdown).not.toContain('Infinity×')
    expect(markdown.split('\n').at(-1)).toContain('| — |')
  })

  it.each([
    { name: 'an empty result set', records: [], message: 'results are empty' },
    {
      name: 'a malformed record',
      records: [record({ wallMs: Number.NaN })],
      message: "record 1 field 'wallMs' must be a finite non-negative number",
    },
    {
      name: 'an extra result key',
      records: [{ ...record(), extra: true } as RunRecord],
      message: 'record 1 must have exactly the 16 result keys',
    },
    {
      name: 'an unsupported engine',
      records: [record({ engine: 'sqlite' as RunRecord['engine'] })],
      message: "record 1 field 'engine' must be parquetjs|duckdb",
    },
    {
      name: 'a duplicate cell',
      records: [...pair(), record()],
      message: 'duplicate cell (btc-outputs, parquetjs, 1)',
    },
    {
      name: 'a missing engine',
      records: [record()],
      message: "indexer 'btc-outputs' is missing engine 'duckdb'",
    },
    {
      name: 'mismatched engine rep sets',
      records: [...pair(), record({ rep: 2 })],
      message: "indexer 'btc-outputs' has mismatched rep sets",
    },
    {
      name: 'a gapped rep set',
      records: [...pair(), ...pair({ rep: 3 })],
      message: "indexer 'btc-outputs' reps must be contiguous from 1",
    },
    {
      name: 'globally missing cells',
      records: [...pair(), ...pair({ rep: 2 }), ...pair({ indexer: 'ethereum-logs' })],
      message: "indexer 'ethereum-logs' rep set differs from the matrix",
    },
    {
      name: 'mismatched paired rows',
      records: [record(), record({ engine: 'duckdb', rows: 999 })],
      message: "indexer 'btc-outputs' rep 1 has mismatched rows",
    },
    {
      name: 'mismatched paired ranges',
      records: [record(), record({ engine: 'duckdb', range: { from: 11, to: 20 } })],
      message: "indexer 'btc-outputs' rep 1 has mismatched ranges",
    },
  ])('rejects $name', ({ records, message }) => {
    expect(() => aggregate(records)).toThrow(message)
  })
})

describe('aggregate CLI', () => {
  function dependencies(content: string): {
    dependencies: AggregateDependencies
    readText: ReturnType<typeof vi.fn<AggregateDependencies['readText']>>
    writeOutput: ReturnType<typeof vi.fn<AggregateDependencies['writeOutput']>>
    writeError: ReturnType<typeof vi.fn<AggregateDependencies['writeError']>>
  } {
    const readText = vi.fn(async () => content)
    const writeOutput = vi.fn()
    const writeError = vi.fn()

    return { dependencies: { readText, writeOutput, writeError }, readText, writeOutput, writeError }
  }

  it('parses an explicit results path and has a fixture default', () => {
    expect(parseAggregateArgs(['--results', '/tmp/results.jsonl'])).toEqual({ results: '/tmp/results.jsonl' })
    expect(parseAggregateArgs([]).results).toMatch(/bench-pipeline[/\\]\.fixtures[/\\]results\.jsonl$/)
  })

  it.each([
    { args: ['--wat', 'x'], message: "unknown flag '--wat'" },
    { args: ['results.jsonl'], message: "unknown argument 'results.jsonl'" },
    { args: ['--results'], message: "missing value for '--results'" },
    { args: ['--results', ''], message: "missing value for '--results'" },
    { args: ['--results', '--wat'], message: "missing value for '--results'" },
    { args: ['--results', 'a', '--results', 'b'], message: "duplicate flag '--results'" },
  ])('rejects malformed arguments: $message', ({ args, message }) => {
    expect(() => parseAggregateArgs(args)).toThrow(message)
  })

  it('reads JSONL, validates all lines, and prints markdown', async () => {
    const harness = dependencies(`${JSON.stringify(record())}\n${JSON.stringify(record({ engine: 'duckdb' }))}\n`)

    await runAggregateCli(['--results', '/tmp/results.jsonl'], harness.dependencies)

    expect(harness.readText).toHaveBeenCalledWith('/tmp/results.jsonl')
    expect(harness.writeOutput).toHaveBeenCalledOnce()
    expect(harness.writeOutput.mock.calls[0]?.[0]).toContain('| btc-outputs | duckdb vs parquetjs |')
  })

  it('reports malformed JSON with its line and exits nonzero without output', async () => {
    const harness = dependencies(`${JSON.stringify(record())}\nnot-json\n`)

    expect(await aggregateMain(['--results', '/tmp/results.jsonl'], harness.dependencies)).toBe(1)
    expect(harness.writeError).toHaveBeenCalledWith(expect.stringContaining('/tmp/results.jsonl line 2'))
    expect(harness.writeOutput).not.toHaveBeenCalled()
  })

  it('reports an incomplete matrix as nonzero without output', async () => {
    const harness = dependencies(`${JSON.stringify(record())}\n`)

    expect(await aggregateMain(['--results', '/tmp/results.jsonl'], harness.dependencies)).toBe(1)
    expect(harness.writeError).toHaveBeenCalledWith(expect.stringContaining("missing engine 'duckdb'"))
    expect(harness.writeOutput).not.toHaveBeenCalled()
  })

  it('validates arguments before reading the filesystem', async () => {
    const harness = dependencies('')

    expect(await aggregateMain(['--wat', 'x'], harness.dependencies)).toBe(1)
    expect(harness.readText).not.toHaveBeenCalled()
  })

  it('recognizes only its own direct invocation', () => {
    const entry = path.join(import.meta.dirname, 'aggregate.ts')

    expect(isDirectInvocation(pathToFileURL(entry).href, entry)).toBe(true)
    expect(isDirectInvocation(pathToFileURL(entry).href, undefined)).toBe(false)
    expect(isDirectInvocation(pathToFileURL(entry).href, path.resolve('other.ts'))).toBe(false)
  })
})
