#!/usr/bin/env -S pnpm tsx
// Aggregates run-matrix results into a markdown comparison table (medians across reps).
// Usage (from packages/pipes/): pnpm tsx scripts/bench-pipeline/aggregate.ts [--results path]
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export type Engine = 'parquetjs' | 'duckdb'

export type RunRecord = {
  indexer: string
  engine: Engine
  rep: number
  range: { from: number; to: number }
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

export type EngineSummary = {
  indexer: string
  engine: Engine
  runs: number
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
}

export type AggregateArguments = { results: string }

export type AggregateDependencies = {
  readText(file: string): Promise<string>
  writeOutput(message: string): void
  writeError(message: string): void
}

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
] as const satisfies readonly (keyof RunRecord)[]

const INTEGER_FIELDS = ['rows', 'batches', 'files'] as const
const NUMBER_FIELDS = [
  'wallMs',
  'rowsPerSec',
  'mainThreadMs',
  'cpuMs',
  'maxStallMs',
  'p99StallMs',
  'peakRssMB',
  'fileMB',
] as const

const defaultDependencies: AggregateDependencies = {
  readText(file) {
    return readFile(file, 'utf8')
  },
  writeOutput(message) {
    process.stdout.write(message)
  },
  writeError(message) {
    console.error(message)
  },
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)

  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function requireNonemptyString(value: unknown, label: string, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} field '${field}' must be a nonempty string`)
  }
}

function requireNonNegativeInteger(value: unknown, label: string, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} field '${field}' must be a safe non-negative integer`)
  }
}

function requirePositiveInteger(value: unknown, label: string, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} field '${field}' must be a safe positive integer`)
  }
}

function requireNonNegativeNumber(value: unknown, label: string, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} field '${field}' must be a finite non-negative number`)
  }
}

function validateRange(value: unknown, label: string): asserts value is RunRecord['range'] {
  if (!isObject(value) || !hasExactKeys(value, ['from', 'to'])) {
    throw new Error(`${label} field 'range' must have exactly 'from' and 'to'`)
  }
  requireNonNegativeInteger(value['from'], label, 'range.from')
  requireNonNegativeInteger(value['to'], label, 'range.to')
  if (value['from'] > value['to']) {
    throw new Error(`${label} field 'range' has from ${value['from']} greater than to ${value['to']}`)
  }
}

export function validateRunRecord(value: unknown, label: string): RunRecord {
  if (!isObject(value) || !hasExactKeys(value, RESULT_KEYS)) {
    throw new Error(`${label} must have exactly the 16 result keys`)
  }

  requireNonemptyString(value['indexer'], label, 'indexer')
  if (value['engine'] !== 'parquetjs' && value['engine'] !== 'duckdb') {
    throw new Error(`${label} field 'engine' must be parquetjs|duckdb`)
  }
  requirePositiveInteger(value['rep'], label, 'rep')
  validateRange(value['range'], label)
  for (const field of INTEGER_FIELDS) requireNonNegativeInteger(value[field], label, field)
  for (const field of NUMBER_FIELDS) requireNonNegativeNumber(value[field], label, field)
  requireNonemptyString(value['node'], label, 'node')

  return value as RunRecord
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function equalNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function summarize(indexer: string, engine: Engine, runs: RunRecord[]): EngineSummary {
  return {
    indexer,
    engine,
    runs: runs.length,
    rows: median(runs.map((run) => run.rows)),
    batches: median(runs.map((run) => run.batches)),
    wallMs: median(runs.map((run) => run.wallMs)),
    rowsPerSec: median(runs.map((run) => run.rowsPerSec)),
    mainThreadMs: median(runs.map((run) => run.mainThreadMs)),
    cpuMs: median(runs.map((run) => run.cpuMs)),
    maxStallMs: median(runs.map((run) => run.maxStallMs)),
    p99StallMs: median(runs.map((run) => run.p99StallMs)),
    peakRssMB: median(runs.map((run) => run.peakRssMB)),
    files: median(runs.map((run) => run.files)),
    fileMB: median(runs.map((run) => run.fileMB)),
  }
}

export function aggregate(records: RunRecord[]): Map<string, Map<string, EngineSummary>> {
  if (records.length === 0) throw new Error('results are empty')

  const grouped = new Map<string, Map<Engine, Map<number, RunRecord>>>()
  for (const [index, candidate] of records.entries()) {
    const run = validateRunRecord(candidate, `record ${index + 1}`)
    const engines = grouped.get(run.indexer) ?? new Map<Engine, Map<number, RunRecord>>()
    const reps = engines.get(run.engine) ?? new Map<number, RunRecord>()
    if (reps.has(run.rep)) {
      throw new Error(`duplicate cell (${run.indexer}, ${run.engine}, ${run.rep})`)
    }
    reps.set(run.rep, run)
    engines.set(run.engine, reps)
    grouped.set(run.indexer, engines)
  }

  let matrixReps: number[] | undefined
  const out = new Map<string, Map<string, EngineSummary>>()
  for (const indexer of [...grouped.keys()].sort()) {
    const engines = grouped.get(indexer)
    if (!engines) throw new Error(`internal aggregation error for '${indexer}'`)

    for (const engine of ['parquetjs', 'duckdb'] as const) {
      if (!engines.has(engine)) throw new Error(`indexer '${indexer}' is missing engine '${engine}'`)
    }

    const parquetjs = engines.get('parquetjs')
    const duckdb = engines.get('duckdb')
    if (!parquetjs || !duckdb) throw new Error(`internal engine-pair error for '${indexer}'`)

    const parquetjsReps = [...parquetjs.keys()].sort((a, b) => a - b)
    const duckdbReps = [...duckdb.keys()].sort((a, b) => a - b)
    if (!equalNumbers(parquetjsReps, duckdbReps)) {
      throw new Error(`indexer '${indexer}' has mismatched rep sets`)
    }
    if (parquetjsReps.some((rep, index) => rep !== index + 1)) {
      throw new Error(`indexer '${indexer}' reps must be contiguous from 1`)
    }
    if (matrixReps === undefined) matrixReps = parquetjsReps
    else if (!equalNumbers(parquetjsReps, matrixReps)) {
      throw new Error(`indexer '${indexer}' rep set differs from the matrix`)
    }

    for (const rep of parquetjsReps) {
      const pjsRun = parquetjs.get(rep)
      const duckRun = duckdb.get(rep)
      if (!pjsRun || !duckRun) throw new Error(`internal paired-run error for '${indexer}' rep ${rep}`)
      if (pjsRun.rows !== duckRun.rows) {
        throw new Error(`indexer '${indexer}' rep ${rep} has mismatched rows`)
      }
      if (pjsRun.range.from !== duckRun.range.from || pjsRun.range.to !== duckRun.range.to) {
        throw new Error(`indexer '${indexer}' rep ${rep} has mismatched ranges`)
      }
    }

    out.set(
      indexer,
      new Map<string, EngineSummary>([
        ['parquetjs', summarize(indexer, 'parquetjs', [...parquetjs.values()])],
        ['duckdb', summarize(indexer, 'duckdb', [...duckdb.values()])],
      ]),
    )
  }

  return out
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return '—'

  const quotient = numerator / denominator
  if (!Number.isFinite(quotient)) return '—'

  return `${quotient.toFixed(2)}×`
}

export function renderMarkdown(summary: Map<string, Map<string, EngineSummary>>): string {
  const lines = [
    '| indexer | engine | rows | wall s | rows/s | main-thread s | cpu s | max stall ms | peak RSS MB | file MB |',
    '|---|---|--:|--:|--:|--:|--:|--:|--:|--:|',
  ]
  for (const indexer of [...summary.keys()].sort()) {
    const engines = summary.get(indexer)
    if (!engines) continue

    for (const engine of ['parquetjs', 'duckdb'] as const) {
      const result = engines.get(engine)
      if (!result) continue
      lines.push(
        `| ${indexer} | ${result.engine} | ${result.rows} | ${(result.wallMs / 1_000).toFixed(1)} | ` +
          `${result.rowsPerSec} | ${(result.mainThreadMs / 1_000).toFixed(1)} | ` +
          `${(result.cpuMs / 1_000).toFixed(1)} | ${result.maxStallMs} | ${result.peakRssMB} | ${result.fileMB} |`,
      )
    }

    const parquetjs = engines.get('parquetjs')
    const duckdb = engines.get('duckdb')
    if (parquetjs && duckdb) {
      lines.push(
        `| ${indexer} | duckdb vs parquetjs | — | ${ratio(parquetjs.wallMs, duckdb.wallMs)} | ` +
          `${ratio(duckdb.rowsPerSec, parquetjs.rowsPerSec)} | ` +
          `${ratio(parquetjs.mainThreadMs, duckdb.mainThreadMs)} | ${ratio(parquetjs.cpuMs, duckdb.cpuMs)} | ` +
          '— | — | — |',
      )
    }
  }

  return lines.join('\n')
}

export function parseAggregateArgs(args: readonly string[]): AggregateArguments {
  let results = path.join(import.meta.dirname, '.fixtures', 'results.jsonl')
  let seenResults = false

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    if (flag === undefined) break
    if (!flag.startsWith('--')) throw new Error(`unknown argument '${flag}'`)
    if (flag !== '--results') throw new Error(`unknown flag '${flag}'`)
    if (seenResults) throw new Error("duplicate flag '--results'")
    seenResults = true

    const value = args[index + 1]
    if (value === undefined || value.trim() === '' || value.startsWith('--')) {
      throw new Error("missing value for '--results'")
    }
    results = value
  }

  return { results }
}

function parseJsonLines(content: string, file: string): RunRecord[] {
  if (content.trim() === '') throw new Error(`${file}: results are empty`)

  const lines = content.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()

  return lines.map((line, index) => {
    const label = `${file} line ${index + 1}`
    if (line.trim() === '') throw new Error(`${label}: empty JSONL line`)

    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      throw new Error(`${label}: invalid JSON: ${message}`)
    }

    return validateRunRecord(value, label)
  })
}

export async function runAggregateCli(
  args: readonly string[],
  dependencies: AggregateDependencies = defaultDependencies,
): Promise<void> {
  const options = parseAggregateArgs(args)
  const content = await dependencies.readText(options.results)
  const records = parseJsonLines(content, options.results)
  dependencies.writeOutput(`${renderMarkdown(aggregate(records))}\n`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function aggregateMain(
  args: readonly string[],
  dependencies: AggregateDependencies = defaultDependencies,
): Promise<number> {
  try {
    await runAggregateCli(args, dependencies)

    return 0
  } catch (error) {
    dependencies.writeError(`ERROR: ${errorMessage(error)}`)

    return 1
  }
}

export function isDirectInvocation(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (argvEntry === undefined) return false

  return moduleUrl === pathToFileURL(path.resolve(argvEntry)).href
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  process.exitCode = await aggregateMain(process.argv.slice(2))
}
