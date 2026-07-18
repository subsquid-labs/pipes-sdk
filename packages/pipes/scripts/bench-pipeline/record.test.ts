import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  type RecordDependencies,
  fixturePath,
  isDirectInvocation,
  parseRecordArgs,
  recordFixtures,
  resolveRange,
} from './record.js'
import type { RowStream } from './types.js'

const KNOWN_IDS = [
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
] as const

type RecorderIndexer = RecordDependencies['indexers'][string]

function streamWithBatchSizes(...sizes: number[]): RowStream {
  return {
    async pipeTo() {},
    async *[Symbol.asyncIterator]() {
      for (const size of sizes) yield { data: Array.from({ length: size }, () => ({})) }
    },
  }
}

function makeIndexer(id: string, range = { from: 10, to: 20 }, batchSizes = [2, 1]) {
  const createStream = vi.fn(() => streamWithBatchSizes(...batchSizes))
  const indexer: RecorderIndexer = { id, range, createStream }

  return { createStream, indexer }
}

function makeDependencies(indexers: Record<string, RecorderIndexer>): {
  dependencies: RecordDependencies
  ensureFixtureDirectory: ReturnType<typeof vi.fn>
  cacheSize: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  log: ReturnType<typeof vi.fn>
} {
  const ensureFixtureDirectory = vi.fn(async () => {})
  const cacheSize = vi.fn(async () => 1_048_576)
  const write = vi.fn()
  const log = vi.fn()
  const times = [1_000, 4_000]

  return {
    dependencies: {
      indexers,
      ensureFixtureDirectory,
      cacheSize,
      now: () => times.shift() ?? 4_000,
      write,
      log,
    },
    ensureFixtureDirectory,
    cacheSize,
    write,
    log,
  }
}

describe('parseRecordArgs', () => {
  it('parses an indexer and explicit bounds while preserving zero', () => {
    expect(parseRecordArgs(['--indexer', 'ethereum-logs', '--from', '0', '--to', '42'])).toEqual({
      indexer: 'ethereum-logs',
      from: 0,
      to: 42,
    })
  })

  it('leaves every override absent when no arguments are supplied', () => {
    expect(parseRecordArgs([])).toEqual({})
  })

  it.each([
    { args: ['--wat'], message: "unknown flag '--wat'" },
    { args: ['ethereum-logs'], message: "unknown argument 'ethereum-logs'" },
    { args: ['--indexer'], message: "missing value for '--indexer'" },
    { args: ['--from', '--to', '2'], message: "missing value for '--from'" },
    { args: ['--to'], message: "missing value for '--to'" },
  ])('rejects malformed argument lists: $message', ({ args, message }) => {
    expect(() => parseRecordArgs(args)).toThrow(message)
  })

  it.each(['-1', '+1', '0x10', '1.5', '1e3', 'NaN', '9007199254740992'])("rejects '%s' as a block bound", (value) => {
    expect(() => parseRecordArgs(['--from', value])).toThrow(`invalid value for '--from': '${value}'`)
  })

  it.each(['--indexer', '--from', '--to'])('rejects duplicate %s flags', (flag) => {
    const value = flag === '--indexer' ? 'btc-blocks' : '1'

    expect(() => parseRecordArgs([flag, value, flag, value])).toThrow(`duplicate flag '${flag}'`)
  })
})

describe('resolveRange', () => {
  it.each([
    { label: 'default', overrides: {}, expected: { from: 10, to: 20 } },
    { label: 'from only', overrides: { from: 0 }, expected: { from: 0, to: 20 } },
    { label: 'to only', overrides: { to: 15 }, expected: { from: 10, to: 15 } },
    { label: 'both bounds', overrides: { from: 0, to: 0 }, expected: { from: 0, to: 0 } },
  ])('resolves the $label effective range', ({ overrides, expected }) => {
    expect(resolveRange({ from: 10, to: 20 }, overrides)).toEqual(expected)
  })

  it('rejects an effective range whose lower bound exceeds its upper bound', () => {
    expect(() => resolveRange({ from: 10, to: 20 }, { to: 9 })).toThrow('invalid effective range: from 10 exceeds to 9')
  })
})

describe('fixture recorder', () => {
  it('uses the exact .fixtures/<id>.sqlite path convention', () => {
    expect(fixturePath('ethereum-logs')).toBe(path.join(import.meta.dirname, '.fixtures', 'ethereum-logs.sqlite'))
  })

  it('can be imported without treating the test runner as a direct CLI invocation', () => {
    expect(isDirectInvocation(import.meta.url, process.argv[1])).toBe(false)
    expect(isDirectInvocation(pathToFileURL(path.resolve('record.ts')).href, path.resolve('record.ts'))).toBe(true)
    expect(isDirectInvocation('file:///tmp/record.ts', undefined)).toBe(false)
  })

  it('rejects an unknown indexer with all 16 known ids before filesystem or network activity', async () => {
    const entries = KNOWN_IDS.map((id) => {
      const { indexer } = makeIndexer(id)

      return [id, indexer] as const
    })
    const registry = Object.fromEntries(entries)
    const { dependencies, ensureFixtureDirectory, cacheSize } = makeDependencies(registry)

    await expect(recordFixtures(['--indexer', 'nope'], dependencies)).rejects.toThrow(
      `unknown indexer 'nope'; known: ${KNOWN_IDS.join(', ')}`,
    )
    expect(ensureFixtureDirectory).not.toHaveBeenCalled()
    expect(cacheSize).not.toHaveBeenCalled()
    for (const indexer of Object.values(registry)) expect(indexer.createStream).not.toHaveBeenCalled()
  })

  it('rejects every invalid effective range before filesystem or network activity', async () => {
    const { createStream, indexer } = makeIndexer('alpha')
    const { dependencies, ensureFixtureDirectory, cacheSize } = makeDependencies({ alpha: indexer })

    await expect(recordFixtures(['--to', '9'], dependencies)).rejects.toThrow(
      'invalid effective range: from 10 exceeds to 9',
    )
    expect(ensureFixtureDirectory).not.toHaveBeenCalled()
    expect(cacheSize).not.toHaveBeenCalled()
    expect(createStream).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'default', args: ['--indexer', 'alpha'], expected: { from: 10, to: 20 } },
    { label: 'from-only', args: ['--indexer', 'alpha', '--from', '0'], expected: { from: 0, to: 20 } },
    { label: 'to-only', args: ['--indexer', 'alpha', '--to', '15'], expected: { from: 10, to: 15 } },
    {
      label: 'full zero range',
      args: ['--indexer', 'alpha', '--from', '0', '--to', '0'],
      expected: { from: 0, to: 0 },
    },
  ])('forwards the exact $label effective range to createStream', async ({ args, expected }) => {
    const { createStream, indexer } = makeIndexer('alpha', { from: 10, to: 20 })
    const { dependencies, ensureFixtureDirectory, cacheSize, write, log } = makeDependencies({ alpha: indexer })

    await recordFixtures(args, dependencies)

    expect(ensureFixtureDirectory).toHaveBeenCalledOnce()
    expect(createStream).toHaveBeenCalledOnce()
    expect(createStream).toHaveBeenCalledWith({ cachePath: fixturePath('alpha'), range: expected })
    expect(cacheSize).toHaveBeenCalledWith(fixturePath('alpha'))
    expect(write).toHaveBeenCalledWith(`recording alpha [${expected.from}..${expected.to}] … `)
    expect(log).toHaveBeenCalledWith('3 rows / 2 batches, 1.0 MiB cache, 3s')
  })
})
