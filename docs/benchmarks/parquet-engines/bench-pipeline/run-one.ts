#!/usr/bin/env -S pnpm tsx
// One full-pipeline benchmark cell: (indexer × engine) in a fresh process, JSON metrics on stdout.
// Usage (from packages/pipes/):
//   pnpm tsx ../../docs/benchmarks/parquet-engines/bench-pipeline/run-one.ts --indexer btc-outputs --engine duckdb [--rep 1]
//     [--from N --to N] [--cache path] [--threads 2] [--keep-out dir]
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

import type { Target } from '../../../../packages/pipes/src/core/index.js'
import { duckdbEngine } from '../../../../packages/pipes/src/targets/parquet/duckdb/index.js'
import {
  type ParquetSettings,
  type ParquetStore,
  type ParquetTable,
  parquetTarget,
  parquetjsEngine,
} from '../../../../packages/pipes/src/targets/parquet/index.js'
import { indexers } from './indexers/index.js'
import type { BenchIndexer, BenchRange, Row } from './types.js'

const MEBIBYTE = 1_024 * 1_024
const MAX_FILE_BYTES = 128 * MEBIBYTE
const RSS_SAMPLE_INTERVAL_MS = 250
const FLAGS = ['--indexer', '--engine', '--rep', '--from', '--to', '--cache', '--threads', '--keep-out'] as const

type Flag = (typeof FLAGS)[number]
type Engine = 'parquetjs' | 'duckdb'
type CpuUsage = NodeJS.CpuUsage
type EventLoopUtilization = { idle: number; active: number; utilization: number }

export type DelayMonitor = {
  readonly max: number
  enable(): boolean
  disable(): boolean
  percentile(percentile: number): number
}

export type RssTimer = {
  unref(): void
  clear(): void
}

type RowStore = Pick<ParquetStore, 'insert'>

export type RunOneTargetOptions = {
  dir: string
  tables: ParquetTable[]
  settings: ParquetSettings
  onData(context: { store: RowStore; data: Row[] }): void
}

export type RunOneArguments = {
  indexer: string
  engine: Engine
  rep: number
  range?: BenchRange
  cachePath?: string
  threads: number
  keepOut?: string
}

export type RunOneResult = {
  indexer: string
  engine: Engine
  rep: number
  range: BenchRange
  rows: number
  batches: number
  wallMs: number
  rowsPerSec: number
  mainThreadMs: number
  cpuMs: number
  maxStallMs: number
  p99StallMs: number
  peakRssMB: number
  files: number
  fileMB: number
  node: string
}

export type RunOneDependencies = {
  indexers: Readonly<Record<string, BenchIndexer>>
  createTarget(options: RunOneTargetOptions): Target<Row[]>
  createTempDirectory(prefix: string): Promise<string>
  removeOutput(directory: string): Promise<void>
  inspectOutput(directory: string, table: string): Promise<{ files: number; bytes: number }>
  createDelayMonitor(): DelayMonitor
  scheduleInterval(callback: () => void, milliseconds: number): RssTimer
  rssBytes(): number
  now(): number
  cpuUsage(start?: CpuUsage): CpuUsage
  eventLoopUtilization(start?: EventLoopUtilization): EventLoopUtilization
  nodeVersion: string
  writeOutput(message: string): void
}

export async function inspectParquetOutput(
  directory: string,
  table: string,
): Promise<{ files: number; bytes: number }> {
  const tableDirectory = path.join(directory, table)
  const files = (await readdir(tableDirectory)).filter((file) => file.endsWith('.parquet'))
  let bytes = 0
  for (const file of files) bytes += (await stat(path.join(tableDirectory, file))).size

  return { files: files.length, bytes }
}

const defaultDependencies: RunOneDependencies = {
  indexers,
  createTarget(options) {
    return parquetTarget<Row[]>(options)
  },
  createTempDirectory: mkdtemp,
  async removeOutput(directory) {
    await rm(directory, { recursive: true, force: true })
  },
  inspectOutput: inspectParquetOutput,
  createDelayMonitor() {
    return monitorEventLoopDelay({ resolution: 10 })
  },
  scheduleInterval(callback, milliseconds) {
    const timer = setInterval(callback, milliseconds)

    return {
      unref() {
        timer.unref()
      },
      clear() {
        clearInterval(timer)
      },
    }
  },
  rssBytes: process.memoryUsage.rss,
  now: () => performance.now(),
  cpuUsage: (start) => process.cpuUsage(start),
  eventLoopUtilization: (start) => performance.eventLoopUtilization(start),
  nodeVersion: process.version,
  writeOutput(message) {
    process.stdout.write(message)
  },
}

function isFlag(value: string): value is Flag {
  return FLAGS.some((flag) => flag === value)
}

function parseNonNegativeInteger(flag: '--from' | '--to', value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`invalid value for '${flag}': '${value}'`)

  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`invalid value for '${flag}': '${value}'`)

  return number
}

function parsePositiveInteger(flag: '--rep' | '--threads', value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`invalid value for '${flag}': '${value}'`)

  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`invalid value for '${flag}': '${value}'`)

  return number
}

export function parseRunOneArgs(args: readonly string[]): RunOneArguments {
  const values = new Map<Flag, string>()

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    if (!flag.startsWith('--')) throw new Error(`unknown argument '${flag}'`)
    if (!isFlag(flag)) throw new Error(`unknown flag '${flag}'`)
    if (values.has(flag)) throw new Error(`duplicate flag '${flag}'`)

    const value = args[index + 1]
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      throw new Error(`missing value for '${flag}'`)
    }
    values.set(flag, value)
  }

  const indexer = values.get('--indexer')
  if (indexer === undefined) throw new Error("missing required flag '--indexer'")

  const selectedEngine = values.get('--engine')
  if (selectedEngine === undefined) throw new Error("missing required flag '--engine'")
  if (selectedEngine !== 'parquetjs' && selectedEngine !== 'duckdb') {
    throw new Error('--engine must be parquetjs|duckdb')
  }

  const fromValue = values.get('--from')
  const toValue = values.get('--to')
  if ((fromValue === undefined) !== (toValue === undefined)) {
    throw new Error('--from and --to must be provided together')
  }

  let range: BenchRange | undefined
  if (fromValue !== undefined && toValue !== undefined) {
    const from = parseNonNegativeInteger('--from', fromValue)
    const to = parseNonNegativeInteger('--to', toValue)
    if (from > to) throw new Error(`invalid range: from ${from} exceeds to ${to}`)
    range = { from, to }
  }

  const cachePath = values.get('--cache')
  const keepOut = values.get('--keep-out')

  return {
    indexer,
    engine: selectedEngine,
    rep: parsePositiveInteger('--rep', values.get('--rep') ?? '1'),
    ...(range === undefined ? {} : { range }),
    ...(cachePath === undefined ? {} : { cachePath }),
    threads: parsePositiveInteger('--threads', values.get('--threads') ?? '2'),
    ...(keepOut === undefined ? {} : { keepOut }),
  }
}

function fixturePath(id: string): string {
  return path.join(import.meta.dirname, '.fixtures', `${id}.sqlite`)
}

export function isDirectInvocation(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (argvEntry === undefined) return false

  return moduleUrl === pathToFileURL(path.resolve(argvEntry)).href
}

function selectIndexer(id: string, registry: RunOneDependencies['indexers']): BenchIndexer {
  if (!Object.hasOwn(registry, id)) {
    throw new Error(`unknown indexer '${id}'; known: ${Object.keys(registry).join(', ')}`)
  }

  return registry[id]
}

export async function runOne(
  args: readonly string[],
  dependencies: RunOneDependencies = defaultDependencies,
): Promise<void> {
  const options = parseRunOneArgs(args)
  const indexer = selectIndexer(options.indexer, dependencies.indexers)
  const range = options.range ?? indexer.range
  const cachePath = options.cachePath ?? fixturePath(indexer.id)
  const isTemporaryOutput = options.keepOut === undefined
  const outputDirectory =
    options.keepOut ??
    (await dependencies.createTempDirectory(path.join(tmpdir(), `bench-${indexer.id}-${options.engine}-`)))

  const result = await (async (): Promise<RunOneResult> => {
    try {
      let rows = 0
      let batches = 0
      const target = dependencies.createTarget({
        dir: outputDirectory,
        tables: [indexer.table],
        settings: {
          rollover: { maxBytes: MAX_FILE_BYTES },
          compression: 'SNAPPY',
          engine: options.engine === 'duckdb' ? duckdbEngine({ threads: options.threads }) : parquetjsEngine(),
        },
        onData: ({ store, data }) => {
          rows += data.length
          batches += 1
          store.insert(indexer.table.table, data)
        },
      })

      const pipeline = await (async () => {
        let delayMonitor: DelayMonitor | undefined
        let rssTimer: RssTimer | undefined

        try {
          let peakRss = dependencies.rssBytes()
          const sampleRss = () => {
            peakRss = Math.max(peakRss, dependencies.rssBytes())
          }
          rssTimer = dependencies.scheduleInterval(sampleRss, RSS_SAMPLE_INTERVAL_MS)
          rssTimer.unref()
          delayMonitor = dependencies.createDelayMonitor()
          delayMonitor.enable()

          const cpuStart = dependencies.cpuUsage()
          const eventLoopStart = dependencies.eventLoopUtilization()
          const wallStart = dependencies.now()

          await indexer.createStream({ cachePath, range }).pipeTo(target)

          const wallMs = dependencies.now() - wallStart
          const eventLoop = dependencies.eventLoopUtilization(eventLoopStart)
          const cpu = dependencies.cpuUsage(cpuStart)
          sampleRss()

          return {
            wallMs,
            eventLoop,
            cpu,
            maxStallMs: delayMonitor.max / 1e6,
            p99StallMs: delayMonitor.percentile(99) / 1e6,
            peakRss,
          }
        } finally {
          try {
            delayMonitor?.disable()
          } finally {
            rssTimer?.clear()
          }
        }
      })()

      const output = await dependencies.inspectOutput(outputDirectory, indexer.table.table)

      return {
        indexer: indexer.id,
        engine: options.engine,
        rep: options.rep,
        range,
        rows,
        batches,
        wallMs: Math.round(pipeline.wallMs),
        rowsPerSec: pipeline.wallMs > 0 ? Math.round(rows / (pipeline.wallMs / 1_000)) : 0,
        mainThreadMs: Math.round(pipeline.eventLoop.active),
        cpuMs: Math.round((pipeline.cpu.user + pipeline.cpu.system) / 1_000),
        maxStallMs: Math.round(pipeline.maxStallMs),
        p99StallMs: Math.round(pipeline.p99StallMs),
        peakRssMB: Math.round(pipeline.peakRss / MEBIBYTE),
        files: output.files,
        fileMB: Math.round((output.bytes / MEBIBYTE) * 10) / 10,
        node: dependencies.nodeVersion,
      }
    } finally {
      if (isTemporaryOutput) await dependencies.removeOutput(outputDirectory)
    }
  })()

  dependencies.writeOutput(`${JSON.stringify(result)}\n`)
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  await runOne(process.argv.slice(2))
}
