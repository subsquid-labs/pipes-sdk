import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import type { RunRecord } from './aggregate.js'
import {
  type MatrixCell,
  type RunMatrixDependencies,
  type SpawnResult,
  isDirectInvocation,
  matrixMain,
  parseChildResult,
  parseRunMatrixArgs,
  runMatrix,
} from './run-matrix.js'

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    indexer: 'alpha',
    engine: 'parquetjs',
    rep: 1,
    range: { from: 0, to: 5 },
    rows: 100,
    batches: 2,
    wallMs: 100,
    rowsPerSec: 1_000,
    mainThreadMs: 80,
    cpuMs: 90,
    maxStallMs: 5,
    p99StallMs: 3,
    peakRssMB: 120,
    files: 1,
    fileMB: 2.5,
    node: 'v22.23.1',
    ...overrides,
  }
}

type Harness = {
  dependencies: RunMatrixDependencies
  ensureResultsDirectory: ReturnType<typeof vi.fn<RunMatrixDependencies['ensureResultsDirectory']>>
  spawn: ReturnType<typeof vi.fn<RunMatrixDependencies['spawn']>>
  appendResult: ReturnType<typeof vi.fn<RunMatrixDependencies['appendResult']>>
  log: ReturnType<typeof vi.fn<RunMatrixDependencies['log']>>
}

function harness(spawnResults: Array<SpawnResult | Error> = []): Harness {
  const ensureResultsDirectory = vi.fn(async () => {})
  const spawn = vi.fn<RunMatrixDependencies['spawn']>(() => {
    const next = spawnResults.shift()
    if (next instanceof Error) throw next

    return next ?? { status: 0, stdout: `${JSON.stringify(record())}\n` }
  })
  const appendResult = vi.fn(async () => {})
  const log = vi.fn()

  return {
    dependencies: {
      indexers: { alpha: {}, beta: {} },
      runOnePath: '/bench/run-one.ts',
      ensureResultsDirectory,
      spawn,
      appendResult,
      log,
    },
    ensureResultsDirectory,
    spawn,
    appendResult,
    log,
  }
}

function childArgs(cell: MatrixCell): string[] {
  return [
    'tsx',
    '/bench/run-one.ts',
    '--indexer',
    cell.indexer,
    '--engine',
    cell.engine,
    '--rep',
    String(cell.rep),
    '--from',
    String(cell.range?.from),
    '--to',
    String(cell.range?.to),
  ]
}

describe('parseRunMatrixArgs', () => {
  it('parses all flags, preserves a zero range, and validates registry ownership', () => {
    expect(
      parseRunMatrixArgs(
        [
          '--indexers',
          'beta,alpha',
          '--engines',
          'duckdb,parquetjs',
          '--reps',
          '2',
          '--results',
          '/tmp/results.jsonl',
          '--from',
          '0',
          '--to',
          '0',
        ],
        { alpha: {}, beta: {} },
      ),
    ).toEqual({
      indexers: ['beta', 'alpha'],
      engines: ['duckdb', 'parquetjs'],
      reps: 2,
      results: '/tmp/results.jsonl',
      range: { from: 0, to: 0 },
    })
  })

  it('uses deterministic registry, engine, rep, and results defaults', () => {
    const parsed = parseRunMatrixArgs([], { beta: {}, alpha: {} })

    expect(parsed.indexers).toEqual(['beta', 'alpha'])
    expect(parsed.engines).toEqual(['parquetjs', 'duckdb'])
    expect(parsed.reps).toBe(3)
    expect(parsed.results).toMatch(/bench-pipeline[/\\]\.fixtures[/\\]results\.jsonl$/)
    expect(parsed.range).toBeUndefined()
  })

  it.each([
    { args: ['--wat', 'x'], message: "unknown flag '--wat'" },
    { args: ['alpha'], message: "unknown argument 'alpha'" },
    { args: ['--indexers'], message: "missing value for '--indexers'" },
    { args: ['--indexers', ''], message: "missing value for '--indexers'" },
    { args: ['--indexers', '--engines'], message: "missing value for '--indexers'" },
    { args: ['--indexers', 'alpha', '--indexers', 'beta'], message: "duplicate flag '--indexers'" },
    { args: ['--indexers', 'alpha,,beta'], message: "invalid empty value in '--indexers'" },
    { args: ['--indexers', 'alpha,alpha'], message: "duplicate indexer 'alpha'" },
    { args: ['--indexers', 'missing'], message: "unknown indexer 'missing'" },
    { args: ['--engines', ''], message: "missing value for '--engines'" },
    { args: ['--engines', 'duckdb,duckdb'], message: "duplicate engine 'duckdb'" },
    { args: ['--engines', 'sqlite'], message: "unsupported engine 'sqlite'" },
    { args: ['--reps', '0'], message: "invalid value for '--reps': '0'" },
    { args: ['--reps', '1.5'], message: "invalid value for '--reps': '1.5'" },
    { args: ['--reps', '0x2'], message: "invalid value for '--reps': '0x2'" },
    { args: ['--reps', '9007199254740992'], message: "invalid value for '--reps': '9007199254740992'" },
    { args: ['--results', '   '], message: "missing value for '--results'" },
    { args: ['--from', '0'], message: '--from and --to must be provided together' },
    { args: ['--to', '0'], message: '--from and --to must be provided together' },
    { args: ['--from', '-1', '--to', '1'], message: "invalid value for '--from': '-1'" },
    { args: ['--from', '2', '--to', '1'], message: 'invalid range: from 2 exceeds to 1' },
  ])('rejects malformed arguments: $message', ({ args, message }) => {
    expect(() => parseRunMatrixArgs(args, { alpha: {}, beta: {} })).toThrow(message)
  })

  it('rejects inherited registry keys', () => {
    const registry = Object.create({ inherited: {} }) as Record<string, unknown>
    registry['alpha'] = {}

    expect(() => parseRunMatrixArgs(['--indexers', 'inherited'], registry)).toThrow("unknown indexer 'inherited'")
  })
})

describe('child result validation', () => {
  const cell: MatrixCell = { indexer: 'alpha', engine: 'parquetjs', rep: 1, range: { from: 0, to: 5 } }

  it('accepts exactly one valid line with the exact 16-key contract', () => {
    const parsed = parseChildResult(`  ${JSON.stringify(record())}  \n`, cell)

    expect(Object.keys(parsed)).toEqual([
      'indexer',
      'engine',
      'rep',
      'range',
      'rows',
      'batches',
      'wallMs',
      'rowsPerSec',
      'mainThreadMs',
      'cpuMs',
      'maxStallMs',
      'p99StallMs',
      'peakRssMB',
      'files',
      'fileMB',
      'node',
    ])
  })

  it.each([
    { name: 'empty output', stdout: '', message: 'expected exactly one nonempty stdout line' },
    {
      name: 'multiple nonempty lines',
      stdout: `${JSON.stringify(record())}\npino noise\n`,
      message: 'expected exactly one nonempty stdout line',
    },
    { name: 'invalid JSON', stdout: '{nope}\n', message: 'invalid child JSON' },
    {
      name: 'an extra key',
      stdout: `${JSON.stringify({ ...record(), extra: true })}\n`,
      message: 'child result must have exactly the 16 result keys',
    },
    {
      name: 'an invalid concrete field',
      stdout: `${JSON.stringify(record({ files: -1 }))}\n`,
      message: "child result field 'files' must be a safe non-negative integer",
    },
    {
      name: 'a mismatched indexer',
      stdout: `${JSON.stringify(record({ indexer: 'beta' }))}\n`,
      message: "child result indexer 'beta' does not match 'alpha'",
    },
    {
      name: 'a mismatched engine',
      stdout: `${JSON.stringify(record({ engine: 'duckdb' }))}\n`,
      message: "child result engine 'duckdb' does not match 'parquetjs'",
    },
    {
      name: 'a mismatched rep',
      stdout: `${JSON.stringify(record({ rep: 2 }))}\n`,
      message: 'child result rep 2 does not match 1',
    },
    {
      name: 'a mismatched explicit range',
      stdout: `${JSON.stringify(record({ range: { from: 1, to: 5 } }))}\n`,
      message: 'child result range [1..5] does not match [0..5]',
    },
  ])('rejects $name', ({ stdout, message }) => {
    expect(() => parseChildResult(stdout, cell)).toThrow(message)
  })

  it('does not require a default child range to equal an unspecified matrix range', () => {
    expect(
      parseChildResult(`${JSON.stringify(record({ range: { from: 50, to: 60 } }))}\n`, { ...cell, range: undefined })
        .range,
    ).toEqual({
      from: 50,
      to: 60,
    })
  })
})

describe('matrix runner', () => {
  it('runs sequential indexer → rep → engine cells, forwards paired ranges, and appends normalized records', async () => {
    const cells: MatrixCell[] = []
    for (const indexer of ['alpha', 'beta']) {
      for (const rep of [1, 2]) {
        for (const engine of ['parquetjs', 'duckdb'] as const) {
          cells.push({ indexer, engine, rep, range: { from: 0, to: 5 } })
        }
      }
    }
    const spawnResults = cells.map((cell) => ({
      status: 0,
      stdout: `  ${JSON.stringify(record(cell))}  \n`,
    }))
    const testHarness = harness(spawnResults)

    const status = await runMatrix(
      [
        '--indexers',
        'alpha,beta',
        '--engines',
        'parquetjs,duckdb',
        '--reps',
        '2',
        '--results',
        '/tmp/results.jsonl',
        '--from',
        '0',
        '--to',
        '5',
      ],
      testHarness.dependencies,
    )

    expect(status).toBe(0)
    expect(testHarness.ensureResultsDirectory).toHaveBeenCalledWith('/tmp/results.jsonl')
    expect(testHarness.spawn).toHaveBeenCalledTimes(8)
    expect(testHarness.spawn.mock.calls.map(([command, args]) => [command, args])).toEqual(
      cells.map((cell) => ['pnpm', childArgs(cell)]),
    )
    expect(testHarness.appendResult.mock.calls).toEqual(
      cells.map((cell) => ['/tmp/results.jsonl', `${JSON.stringify(record(cell))}\n`]),
    )
    expect(testHarness.log).toHaveBeenLastCalledWith('results → /tmp/results.jsonl')
  })

  it('continues after spawn, exit, and output failures, appends only later valid cells, and returns nonzero', async () => {
    const valid = record({ engine: 'duckdb', rep: 5 })
    const testHarness = harness([
      new Error('spawn exploded'),
      { status: 2, stdout: '' },
      { status: 0, stdout: `${JSON.stringify(record({ engine: 'duckdb', rep: 3 }))}\nnoise\n` },
      { status: 0, stdout: `${JSON.stringify(record({ engine: 'duckdb', rep: 99 }))}\n` },
      { status: 0, stdout: `${JSON.stringify(valid)}\n` },
    ])

    const status = await runMatrix(
      ['--indexers', 'alpha', '--engines', 'duckdb', '--reps', '5', '--results', '/tmp/results.jsonl'],
      testHarness.dependencies,
    )

    expect(status).toBe(1)
    expect(testHarness.spawn).toHaveBeenCalledTimes(5)
    expect(testHarness.appendResult).toHaveBeenCalledOnce()
    expect(testHarness.appendResult).toHaveBeenCalledWith('/tmp/results.jsonl', `${JSON.stringify(valid)}\n`)
    expect(testHarness.log).toHaveBeenLastCalledWith('completed with 4 failure(s); valid results → /tmp/results.jsonl')
  })

  it('validates the full request before mkdir, spawn, or append', async () => {
    const testHarness = harness()

    await expect(runMatrix(['--from', '0'], testHarness.dependencies)).rejects.toThrow(
      '--from and --to must be provided together',
    )
    expect(testHarness.ensureResultsDirectory).not.toHaveBeenCalled()
    expect(testHarness.spawn).not.toHaveBeenCalled()
    expect(testHarness.appendResult).not.toHaveBeenCalled()
  })

  it('aborts immediately when durable append fails', async () => {
    const testHarness = harness([{ status: 0, stdout: `${JSON.stringify(record())}\n` }])
    testHarness.appendResult.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      runMatrix(
        ['--indexers', 'alpha', '--engines', 'parquetjs', '--reps', '2', '--results', '/tmp/results.jsonl'],
        testHarness.dependencies,
      ),
    ).rejects.toThrow('disk full')
    expect(testHarness.spawn).toHaveBeenCalledOnce()
  })

  it('maps runner validation failure to a nonzero main outcome', async () => {
    const testHarness = harness()

    expect(await matrixMain(['--wat', 'x'], testHarness.dependencies)).toBe(1)
    expect(testHarness.log).toHaveBeenCalledWith(expect.stringContaining("unknown flag '--wat'"))
  })

  it('recognizes only its own direct invocation', () => {
    const entry = path.resolve('scripts/bench-pipeline/run-matrix.ts')

    expect(isDirectInvocation(pathToFileURL(entry).href, entry)).toBe(true)
    expect(isDirectInvocation(pathToFileURL(entry).href, undefined)).toBe(false)
    expect(isDirectInvocation(pathToFileURL(entry).href, path.resolve('other.ts'))).toBe(false)
  })
})
