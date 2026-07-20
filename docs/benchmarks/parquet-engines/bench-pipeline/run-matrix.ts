#!/usr/bin/env -S pnpm tsx
// Drives the benchmark matrix: one fresh OS process per (indexer × engine × rep) cell, sequential.
// Engines are interleaved inside each rep to spread thermal/background drift evenly.
// Usage (from packages/pipes/):
//   pnpm tsx ../../docs/benchmarks/parquet-engines/bench-pipeline/run-matrix.ts [--indexers a,b] [--engines parquetjs,duckdb]
//     [--reps 3] [--results path] [--from N --to N]
import { spawnSync } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { type Engine, type RunRecord, validateRunRecord } from './aggregate.js'
import { indexers } from './indexers/index.js'

const FLAGS = ['--indexers', '--engines', '--reps', '--results', '--from', '--to'] as const
type Flag = (typeof FLAGS)[number]

export type MatrixCell = {
  indexer: string
  engine: Engine
  rep: number
  range?: RunRecord['range']
}

export type RunMatrixArguments = {
  indexers: string[]
  engines: Engine[]
  reps: number
  results: string
  range?: RunRecord['range']
}

export type SpawnResult = { status: number | null; stdout: string }

export type RunMatrixDependencies = {
  indexers: Readonly<Record<string, unknown>>
  runOnePath: string
  ensureResultsDirectory(results: string): Promise<void>
  spawn(command: string, args: readonly string[]): SpawnResult
  appendResult(results: string, line: string): Promise<void>
  log(message: string): void
}

const defaultDependencies: RunMatrixDependencies = {
  indexers,
  runOnePath: path.join(import.meta.dirname, 'run-one.ts'),
  async ensureResultsDirectory(results) {
    await mkdir(path.dirname(results), { recursive: true })
  },
  spawn(command, args) {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    if (result.error) throw result.error

    return { status: result.status, stdout: result.stdout ?? '' }
  },
  appendResult: appendFile,
  log(message) {
    console.error(message)
  },
}

function isFlag(value: string): value is Flag {
  return FLAGS.some((flag) => flag === value)
}

function parsePositiveInteger(flag: '--reps', value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`invalid value for '${flag}': '${value}'`)

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid value for '${flag}': '${value}'`)
  }

  return parsed
}

function parseNonNegativeInteger(flag: '--from' | '--to', value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`invalid value for '${flag}': '${value}'`)

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid value for '${flag}': '${value}'`)

  return parsed
}

function parseList(flag: '--indexers' | '--engines', value: string): string[] {
  const entries = value.split(',').map((entry) => entry.trim())
  if (entries.some((entry) => entry === '')) throw new Error(`invalid empty value in '${flag}'`)

  return entries
}

function readFlags(args: readonly string[]): Map<Flag, string> {
  const values = new Map<Flag, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    if (flag === undefined) break
    if (!flag.startsWith('--')) throw new Error(`unknown argument '${flag}'`)
    if (!isFlag(flag)) throw new Error(`unknown flag '${flag}'`)
    if (values.has(flag)) throw new Error(`duplicate flag '${flag}'`)

    const value = args[index + 1]
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      throw new Error(`missing value for '${flag}'`)
    }
    values.set(flag, value)
  }

  return values
}

export function parseRunMatrixArgs(
  args: readonly string[],
  registry: Readonly<Record<string, unknown>>,
): RunMatrixArguments {
  const values = readFlags(args)
  const selectedIndexers = values.has('--indexers')
    ? parseList('--indexers', values.get('--indexers') ?? '')
    : Object.keys(registry)
  if (selectedIndexers.length === 0) throw new Error('indexer list must not be empty')

  const uniqueIndexers = new Set<string>()
  for (const indexer of selectedIndexers) {
    if (uniqueIndexers.has(indexer)) throw new Error(`duplicate indexer '${indexer}'`)
    if (!Object.hasOwn(registry, indexer)) throw new Error(`unknown indexer '${indexer}'`)
    uniqueIndexers.add(indexer)
  }

  const rawEngines = values.has('--engines')
    ? parseList('--engines', values.get('--engines') ?? '')
    : ['parquetjs', 'duckdb']
  const selectedEngines: Engine[] = []
  for (const engine of rawEngines) {
    if (engine !== 'parquetjs' && engine !== 'duckdb') throw new Error(`unsupported engine '${engine}'`)
    if (selectedEngines.some((selected) => selected === engine)) throw new Error(`duplicate engine '${engine}'`)
    selectedEngines.push(engine)
  }

  const fromValue = values.get('--from')
  const toValue = values.get('--to')
  if ((fromValue === undefined) !== (toValue === undefined)) {
    throw new Error('--from and --to must be provided together')
  }

  let range: RunRecord['range'] | undefined
  if (fromValue !== undefined && toValue !== undefined) {
    const from = parseNonNegativeInteger('--from', fromValue)
    const to = parseNonNegativeInteger('--to', toValue)
    if (from > to) throw new Error(`invalid range: from ${from} exceeds to ${to}`)
    range = { from, to }
  }

  return {
    indexers: selectedIndexers,
    engines: selectedEngines,
    reps: parsePositiveInteger('--reps', values.get('--reps') ?? '3'),
    results: values.get('--results') ?? path.join(import.meta.dirname, '.fixtures', 'results.jsonl'),
    ...(range === undefined ? {} : { range }),
  }
}

export function parseChildResult(stdout: string, cell: MatrixCell): RunRecord {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length !== 1) throw new Error('expected exactly one nonempty stdout line')

  let value: unknown
  try {
    value = JSON.parse(lines[0])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`invalid child JSON: ${message}`)
  }

  const result = validateRunRecord(value, 'child result')
  if (result.indexer !== cell.indexer) {
    throw new Error(`child result indexer '${result.indexer}' does not match '${cell.indexer}'`)
  }
  if (result.engine !== cell.engine) {
    throw new Error(`child result engine '${result.engine}' does not match '${cell.engine}'`)
  }
  if (result.rep !== cell.rep) throw new Error(`child result rep ${result.rep} does not match ${cell.rep}`)
  if (cell.range !== undefined && (result.range.from !== cell.range.from || result.range.to !== cell.range.to)) {
    throw new Error(
      `child result range [${result.range.from}..${result.range.to}] does not match ` +
        `[${cell.range.from}..${cell.range.to}]`,
    )
  }

  return result
}

function childArguments(runOnePath: string, cell: MatrixCell): string[] {
  const args = [
    '--import',
    'tsx',
    runOnePath,
    '--indexer',
    cell.indexer,
    '--engine',
    cell.engine,
    '--rep',
    String(cell.rep),
  ]
  if (cell.range !== undefined) {
    args.push('--from', String(cell.range.from), '--to', String(cell.range.to))
  }

  return args
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runMatrix(
  args: readonly string[],
  dependencies: RunMatrixDependencies = defaultDependencies,
): Promise<number> {
  const options = parseRunMatrixArgs(args, dependencies.indexers)
  await dependencies.ensureResultsDirectory(options.results)

  const total = options.indexers.length * options.engines.length * options.reps
  let completed = 0
  let failures = 0
  for (const indexer of options.indexers) {
    for (let rep = 1; rep <= options.reps; rep++) {
      for (const engine of options.engines) {
        completed += 1
        const cell: MatrixCell = {
          indexer,
          engine,
          rep,
          ...(options.range === undefined ? {} : { range: options.range }),
        }
        dependencies.log(`[${completed}/${total}] ${indexer} × ${engine} (rep ${rep})`)

        let spawned: SpawnResult
        try {
          spawned = dependencies.spawn(process.execPath, childArguments(dependencies.runOnePath, cell))
        } catch (error) {
          failures += 1
          dependencies.log(`FAILED: ${indexer} × ${engine} rep ${rep} (spawn: ${errorMessage(error)})`)

          continue
        }

        if (spawned.status !== 0) {
          failures += 1
          dependencies.log(`FAILED: ${indexer} × ${engine} rep ${rep} (exit ${spawned.status})`)

          continue
        }

        let result: RunRecord
        try {
          result = parseChildResult(spawned.stdout, cell)
        } catch (error) {
          failures += 1
          dependencies.log(`FAILED: ${indexer} × ${engine} rep ${rep} (${errorMessage(error)})`)

          continue
        }

        await dependencies.appendResult(options.results, `${JSON.stringify(result)}\n`)
      }
    }
  }

  if (failures > 0) {
    dependencies.log(`completed with ${failures} failure(s); valid results → ${options.results}`)

    return 1
  }

  dependencies.log(`results → ${options.results}`)

  return 0
}

export async function matrixMain(
  args: readonly string[],
  dependencies: RunMatrixDependencies = defaultDependencies,
): Promise<number> {
  try {
    return await runMatrix(args, dependencies)
  } catch (error) {
    dependencies.log(`ERROR: ${errorMessage(error)}`)

    return 1
  }
}

export function isDirectInvocation(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (argvEntry === undefined) return false

  return moduleUrl === pathToFileURL(path.resolve(argvEntry)).href
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  process.exitCode = await matrixMain(process.argv.slice(2))
}
