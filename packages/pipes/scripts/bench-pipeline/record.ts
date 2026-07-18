#!/usr/bin/env -S pnpm tsx
// Records portal fixtures into SQLite caches for offline benchmark replay.
// Usage (from packages/pipes/):
//   pnpm tsx scripts/bench-pipeline/record.ts [--indexer <id>] [--from <block>] [--to <block>]
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { indexers } from './indexers/index.js'
import type { BenchIndexer, BenchRange } from './types.js'

type RecorderIndexer = Pick<BenchIndexer, 'id' | 'range' | 'createStream'>

export type RecordArguments = {
  indexer?: string
  from?: number
  to?: number
}

export type RecordDependencies = {
  indexers: Readonly<Record<string, RecorderIndexer>>
  ensureFixtureDirectory(): Promise<void>
  cacheSize(cachePath: string): Promise<number>
  now(): number
  write(message: string): void
  log(message: string): void
}

const FIXTURE_DIRECTORY = path.join(import.meta.dirname, '.fixtures')
const FLAGS = ['--indexer', '--from', '--to'] as const
type Flag = (typeof FLAGS)[number]

const defaultDependencies: RecordDependencies = {
  indexers,
  async ensureFixtureDirectory() {
    await mkdir(FIXTURE_DIRECTORY, { recursive: true })
  },
  async cacheSize(cachePath) {
    const file = await stat(cachePath)

    return file.size
  },
  now: Date.now,
  write(message) {
    process.stdout.write(message)
  },
  log(message) {
    console.log(message)
  },
}

function isFlag(value: string): value is Flag {
  return FLAGS.some((flag) => flag === value)
}

function parseBlockBound(flag: '--from' | '--to', value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`invalid value for '${flag}': '${value}'`)

  const block = Number(value)
  if (!Number.isSafeInteger(block)) throw new Error(`invalid value for '${flag}': '${value}'`)

  return block
}

export function parseRecordArgs(args: readonly string[]): RecordArguments {
  const parsed: RecordArguments = {}
  const seen = new Set<Flag>()

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    if (flag === undefined) break
    if (!flag.startsWith('--')) throw new Error(`unknown argument '${flag}'`)
    if (!isFlag(flag)) throw new Error(`unknown flag '${flag}'`)
    if (seen.has(flag)) throw new Error(`duplicate flag '${flag}'`)
    seen.add(flag)

    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for '${flag}'`)

    if (flag === '--indexer') parsed.indexer = value
    else if (flag === '--from') parsed.from = parseBlockBound(flag, value)
    else parsed.to = parseBlockBound(flag, value)
  }

  return parsed
}

export function resolveRange(defaultRange: BenchRange, overrides: Pick<RecordArguments, 'from' | 'to'>): BenchRange {
  const range = {
    from: overrides.from ?? defaultRange.from,
    to: overrides.to ?? defaultRange.to,
  }
  if (range.from > range.to) {
    throw new Error(`invalid effective range: from ${range.from} exceeds to ${range.to}`)
  }

  return range
}

export function fixturePath(id: string): string {
  return path.join(FIXTURE_DIRECTORY, `${id}.sqlite`)
}

export function isDirectInvocation(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (argvEntry === undefined) return false

  return moduleUrl === pathToFileURL(path.resolve(argvEntry)).href
}

function selectIndexers(
  requestedId: string | undefined,
  registry: Readonly<Record<string, RecorderIndexer>>,
): RecorderIndexer[] {
  if (requestedId === undefined) return Object.values(registry)

  const selected = registry[requestedId]
  if (!selected) {
    throw new Error(`unknown indexer '${requestedId}'; known: ${Object.keys(registry).join(', ')}`)
  }

  return [selected]
}

export async function recordFixtures(
  args: readonly string[],
  dependencies: RecordDependencies = defaultDependencies,
): Promise<void> {
  const options = parseRecordArgs(args)
  const plans = selectIndexers(options.indexer, dependencies.indexers).map((indexer) => ({
    indexer,
    range: resolveRange(indexer.range, options),
  }))

  await dependencies.ensureFixtureDirectory()

  for (const { indexer, range } of plans) {
    const cachePath = fixturePath(indexer.id)
    const started = dependencies.now()
    let rows = 0
    let batches = 0

    dependencies.write(`recording ${indexer.id} [${range.from}..${range.to}] … `)
    for await (const batch of indexer.createStream({ cachePath, range })) {
      rows += batch.data.length
      batches += 1
    }

    const size = await dependencies.cacheSize(cachePath)
    const seconds = ((dependencies.now() - started) / 1_000).toFixed(0)
    dependencies.log(`${rows} rows / ${batches} batches, ${(size / 1_024 / 1_024).toFixed(1)} MiB cache, ${seconds}s`)
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  await recordFixtures(process.argv.slice(2))
}
