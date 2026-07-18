import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  type DelayMonitor,
  type RunOneDependencies,
  type RunOneTargetOptions,
  isDirectInvocation,
  parseRunOneArgs,
  runOne,
} from './run-one.js'
import type { Row, RowStream } from './types.js'

const MEBIBYTE = 1_024 * 1_024
const RESULT_KEYS = [
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
] as const

type RunnerIndexer = RunOneDependencies['indexers'][string]

type Harness = {
  dependencies: RunOneDependencies
  createStream: ReturnType<typeof vi.fn<RunnerIndexer['createStream']>>
  createTarget: ReturnType<typeof vi.fn<RunOneDependencies['createTarget']>>
  createTempDirectory: ReturnType<typeof vi.fn<RunOneDependencies['createTempDirectory']>>
  removeOutput: ReturnType<typeof vi.fn<RunOneDependencies['removeOutput']>>
  inspectOutput: ReturnType<typeof vi.fn<RunOneDependencies['inspectOutput']>>
  delayMonitor: DelayMonitor
  disableDelayMonitor: ReturnType<typeof vi.fn>
  intervalClear: ReturnType<typeof vi.fn>
  intervalUnref: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  output: string[]
  table: RunnerIndexer['table']
}

function makeHarness(options: { batches?: Row[][]; streamError?: Error } = {}): Harness {
  const batches = options.batches ?? [[{ block_number: 10 }, { block_number: 11 }], [], [{ block_number: 12 }]]
  const table: RunnerIndexer['table'] = {
    table: 'rows',
    blockNumberColumn: 'block_number',
    schema: { block_number: { type: 'INT64' } },
  }
  const insert = vi.fn()
  let targetOptions: RunOneTargetOptions | undefined
  const createTarget = vi.fn<RunOneDependencies['createTarget']>((selected) => {
    targetOptions = selected

    return { async write() {} }
  })
  const pipeTo = vi.fn(async () => {
    if (options.streamError) throw options.streamError
    if (!targetOptions) throw new Error('target was not created before stream execution')

    for (const data of batches) targetOptions.onData({ store: { insert }, data })
  })
  const stream: RowStream = {
    pipeTo,
    async *[Symbol.asyncIterator]() {},
  }
  const createStream = vi.fn<RunnerIndexer['createStream']>(() => stream)
  const indexer: RunnerIndexer = {
    id: 'alpha',
    portalUrl: 'https://portal.invalid',
    range: { from: 10, to: 20 },
    table,
    createStream,
  }
  const createTempDirectory = vi.fn(async () => '/tmp/bench-alpha-duckdb-test')
  const removeOutput = vi.fn(async () => {})
  const inspectOutput = vi.fn(async () => ({ files: 2, bytes: 1.5 * MEBIBYTE }))
  const disableDelayMonitor = vi.fn(() => true)
  const delayMonitor: DelayMonitor = {
    max: 12_400_000,
    enable: vi.fn(() => true),
    disable: disableDelayMonitor,
    percentile: vi.fn(() => 7_600_000),
  }
  const intervalUnref = vi.fn()
  const intervalClear = vi.fn()
  const timer = { unref: intervalUnref, clear: intervalClear }
  const scheduleInterval = vi.fn(() => timer)
  const rssValues = [100 * MEBIBYTE, 125 * MEBIBYTE]
  const times = [100, 350]
  const eventLoopValues = [
    { idle: 0, active: 10, utilization: 1 },
    { idle: 124.6, active: 125.4, utilization: 0.5016 },
  ]
  const output: string[] = []
  const dependencies: RunOneDependencies = {
    indexers: { alpha: indexer },
    createTarget,
    createTempDirectory,
    removeOutput,
    inspectOutput,
    createDelayMonitor: () => delayMonitor,
    scheduleInterval,
    rssBytes: () => rssValues.shift() ?? 125 * MEBIBYTE,
    now: () => times.shift() ?? 350,
    cpuUsage: (start) => (start ? { user: 3_000, system: 2_000 } : { user: 10, system: 20 }),
    eventLoopUtilization: () => eventLoopValues.shift() ?? eventLoopValues[1],
    nodeVersion: 'v22.23.1',
    writeOutput: (message) => output.push(message),
  }

  return {
    dependencies,
    createStream,
    createTarget,
    createTempDirectory,
    removeOutput,
    inspectOutput,
    delayMonitor,
    disableDelayMonitor,
    intervalClear,
    intervalUnref,
    insert,
    output,
    table,
  }
}

describe('parseRunOneArgs', () => {
  it('parses every flag and preserves a paired zero range', () => {
    expect(
      parseRunOneArgs([
        '--indexer',
        'alpha',
        '--engine',
        'duckdb',
        '--rep',
        '3',
        '--from',
        '0',
        '--to',
        '0',
        '--cache',
        '/fixtures/alpha.sqlite',
        '--threads',
        '4',
        '--keep-out',
        '/results/alpha',
      ]),
    ).toEqual({
      indexer: 'alpha',
      engine: 'duckdb',
      rep: 3,
      range: { from: 0, to: 0 },
      cachePath: '/fixtures/alpha.sqlite',
      threads: 4,
      keepOut: '/results/alpha',
    })
  })

  it('applies runner defaults without inventing an explicit range', () => {
    expect(parseRunOneArgs(['--indexer', 'alpha', '--engine', 'parquetjs'])).toEqual({
      indexer: 'alpha',
      engine: 'parquetjs',
      rep: 1,
      threads: 2,
    })
  })

  it.each([
    { args: ['--wat', 'value'], message: "unknown flag '--wat'" },
    { args: ['alpha', '--engine', 'duckdb'], message: "unknown argument 'alpha'" },
    { args: ['--indexer'], message: "missing value for '--indexer'" },
    { args: ['--indexer', ''], message: "missing value for '--indexer'" },
    { args: ['--indexer', '--engine', 'duckdb'], message: "missing value for '--indexer'" },
    {
      args: ['--indexer', 'alpha', '--indexer', 'beta', '--engine', 'duckdb'],
      message: "duplicate flag '--indexer'",
    },
    { args: ['--engine', 'duckdb'], message: "missing required flag '--indexer'" },
    { args: ['--indexer', 'alpha'], message: "missing required flag '--engine'" },
  ])('rejects malformed arguments: $message', ({ args, message }) => {
    expect(() => parseRunOneArgs(args)).toThrow(message)
  })

  it('rejects an unsupported engine', () => {
    expect(() => parseRunOneArgs(['--indexer', 'alpha', '--engine', 'nope'])).toThrow(
      '--engine must be parquetjs|duckdb',
    )
  })

  it.each([
    '-1',
    '+1',
    '0x10',
    '1.5',
    '1e3',
    'NaN',
    '9007199254740992',
  ])("rejects '%s' as a non-negative base-10 safe range bound", (value) => {
    expect(() => parseRunOneArgs(['--indexer', 'alpha', '--engine', 'duckdb', '--from', value, '--to', '1'])).toThrow(
      `invalid value for '--from': '${value}'`,
    )
  })

  it.each([
    { flag: '--rep', value: '0' },
    { flag: '--rep', value: '-1' },
    { flag: '--rep', value: '1.5' },
    { flag: '--threads', value: '0' },
    { flag: '--threads', value: '0x2' },
    { flag: '--threads', value: '9007199254740992' },
  ])('rejects non-positive or non-decimal $flag value $value', ({ flag, value }) => {
    expect(() => parseRunOneArgs(['--indexer', 'alpha', '--engine', 'duckdb', flag, value])).toThrow(
      `invalid value for '${flag}': '${value}'`,
    )
  })

  it.each([
    ['--from', '0'],
    ['--to', '0'],
  ])('rejects a one-sided range beginning with %s', (flag, value) => {
    expect(() => parseRunOneArgs(['--indexer', 'alpha', '--engine', 'duckdb', flag, value])).toThrow(
      '--from and --to must be provided together',
    )
  })

  it('rejects a descending explicit range', () => {
    expect(() => parseRunOneArgs(['--indexer', 'alpha', '--engine', 'duckdb', '--from', '2', '--to', '1'])).toThrow(
      'invalid range: from 2 exceeds to 1',
    )
  })
})

describe('single-cell runner', () => {
  it('forwards default range/cache/settings and emits the exact one-line metric shape and units', async () => {
    const harness = makeHarness()

    await runOne(['--indexer', 'alpha', '--engine', 'duckdb'], harness.dependencies)

    expect(harness.createTempDirectory).toHaveBeenCalledWith(path.join(tmpdir(), 'bench-alpha-duckdb-'))
    expect(harness.createStream).toHaveBeenCalledWith({
      cachePath: path.join(import.meta.dirname, '.fixtures', 'alpha.sqlite'),
      range: { from: 10, to: 20 },
    })
    const targetOptions = harness.createTarget.mock.calls[0]?.[0]
    expect(targetOptions).toBeDefined()
    expect(targetOptions?.dir).toBe('/tmp/bench-alpha-duckdb-test')
    expect(targetOptions?.tables).toEqual([harness.table])
    expect(targetOptions?.settings).toEqual({
      rollover: { maxBytes: 128 * MEBIBYTE },
      compression: 'SNAPPY',
      engine: 'duckdb',
      duckdb: { threads: 2 },
    })
    expect(harness.insert).toHaveBeenNthCalledWith(1, 'rows', [{ block_number: 10 }, { block_number: 11 }])
    expect(harness.insert).toHaveBeenNthCalledWith(2, 'rows', [])
    expect(harness.insert).toHaveBeenNthCalledWith(3, 'rows', [{ block_number: 12 }])
    expect(harness.inspectOutput).toHaveBeenCalledWith('/tmp/bench-alpha-duckdb-test', 'rows')
    expect(harness.output).toHaveLength(1)
    expect(harness.output[0]?.match(/\n/g)).toHaveLength(1)
    expect(harness.output[0]?.endsWith('\n')).toBe(true)
    const result = JSON.parse(harness.output[0] ?? '{}') as Record<string, unknown>
    expect(Object.keys(result)).toEqual(RESULT_KEYS)
    expect(result).toEqual({
      indexer: 'alpha',
      engine: 'duckdb',
      rep: 1,
      range: { from: 10, to: 20 },
      rows: 3,
      batches: 3,
      wallMs: 250,
      rowsPerSec: 12,
      mainThreadMs: 125,
      cpuMs: 5,
      maxStallMs: 12,
      p99StallMs: 8,
      peakRssMB: 125,
      files: 2,
      fileMB: 1.5,
      node: 'v22.23.1',
    })
    expect(harness.delayMonitor.enable).toHaveBeenCalledTimes(1)
    expect(harness.intervalUnref).toHaveBeenCalledTimes(1)
    expect(harness.disableDelayMonitor).toHaveBeenCalledTimes(1)
    expect(harness.intervalClear).toHaveBeenCalledTimes(1)
    expect(harness.removeOutput).toHaveBeenCalledWith('/tmp/bench-alpha-duckdb-test')
  })

  it('forwards explicit range/cache/rep/threads and preserves keep-out under DuckDB', async () => {
    const harness = makeHarness({ batches: [[{ block_number: 0 }]] })

    await runOne(
      [
        '--indexer',
        'alpha',
        '--engine',
        'duckdb',
        '--rep',
        '7',
        '--from',
        '0',
        '--to',
        '0',
        '--cache',
        '/fixtures/custom.sqlite',
        '--threads',
        '6',
        '--keep-out',
        '/results/kept',
      ],
      harness.dependencies,
    )

    expect(harness.createTempDirectory).not.toHaveBeenCalled()
    expect(harness.createStream).toHaveBeenCalledWith({
      cachePath: '/fixtures/custom.sqlite',
      range: { from: 0, to: 0 },
    })
    expect(harness.createTarget.mock.calls[0]?.[0].dir).toBe('/results/kept')
    expect(harness.createTarget.mock.calls[0]?.[0].settings.duckdb).toEqual({ threads: 6 })
    expect(harness.removeOutput).not.toHaveBeenCalled()
    const result = JSON.parse(harness.output[0] ?? '{}') as Record<string, unknown>
    expect(result['rep']).toBe(7)
    expect(result['range']).toEqual({ from: 0, to: 0 })
  })

  it('omits DuckDB tuning from the parquetjs target', async () => {
    const harness = makeHarness()

    await runOne(['--indexer', 'alpha', '--engine', 'parquetjs'], harness.dependencies)

    expect(harness.createTarget.mock.calls[0]?.[0].settings.duckdb).toBeUndefined()
  })

  it.each([
    'missing',
    'constructor',
    'toString',
    '__proto__',
  ])("rejects unknown or inherited indexer id '%s' before every side effect", async (id) => {
    const harness = makeHarness()

    await expect(runOne(['--indexer', id, '--engine', 'duckdb'], harness.dependencies)).rejects.toThrow(
      `unknown indexer '${id}'; known: alpha`,
    )
    expect(harness.createTempDirectory).not.toHaveBeenCalled()
    expect(harness.createTarget).not.toHaveBeenCalled()
    expect(harness.createStream).not.toHaveBeenCalled()
  })

  it('rejects invalid engine syntax before every side effect', async () => {
    const harness = makeHarness()

    await expect(runOne(['--indexer', 'alpha', '--engine', 'nope'], harness.dependencies)).rejects.toThrow(
      '--engine must be parquetjs|duckdb',
    )
    expect(harness.createTempDirectory).not.toHaveBeenCalled()
    expect(harness.createTarget).not.toHaveBeenCalled()
    expect(harness.createStream).not.toHaveBeenCalled()
  })

  it('disables monitoring, clears the timer, and removes temporary output when streaming fails', async () => {
    const harness = makeHarness({ streamError: new Error('stream failed') })

    await expect(runOne(['--indexer', 'alpha', '--engine', 'duckdb'], harness.dependencies)).rejects.toThrow(
      'stream failed',
    )
    expect(harness.disableDelayMonitor).toHaveBeenCalledTimes(1)
    expect(harness.intervalClear).toHaveBeenCalledTimes(1)
    expect(harness.removeOutput).toHaveBeenCalledWith('/tmp/bench-alpha-duckdb-test')
    expect(harness.output).toEqual([])
  })

  it('removes temporary output when file inspection fails', async () => {
    const harness = makeHarness()
    harness.inspectOutput.mockRejectedValueOnce(new Error('stat failed'))

    await expect(runOne(['--indexer', 'alpha', '--engine', 'duckdb'], harness.dependencies)).rejects.toThrow(
      'stat failed',
    )
    expect(harness.disableDelayMonitor).toHaveBeenCalledTimes(1)
    expect(harness.intervalClear).toHaveBeenCalledTimes(1)
    expect(harness.removeOutput).toHaveBeenCalledWith('/tmp/bench-alpha-duckdb-test')
    expect(harness.output).toEqual([])
  })

  it('does not treat a Vitest import as direct CLI execution', () => {
    expect(isDirectInvocation(import.meta.url, process.argv[1])).toBe(false)
    expect(isDirectInvocation(pathToFileURL(path.resolve('run-one.ts')).href, path.resolve('run-one.ts'))).toBe(true)
    expect(isDirectInvocation('file:///tmp/run-one.ts', undefined)).toBe(false)
  })
})
