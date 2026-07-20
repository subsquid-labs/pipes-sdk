import type { DuckDBInstance } from '@duckdb/node-api'

import { PARQUET_ERROR_CODES, ParquetTargetError } from '../errors.js'

/**
 * The dynamically-imported module namespace. Everything duckdb-flavored in this target keeps
 * `@duckdb/node-api` OUT of its top-level runtime imports (type-only imports are erased), so
 * `import '@subsquid/pipes/targets/parquet'` keeps working without the optional dependency —
 * this module's `import()` below is the single load point, reached only when a pipe actually
 * selects `engine: 'duckdb'`.
 */
export type DuckdbApi = typeof import('@duckdb/node-api')

/** Tuning for the shared DuckDB instance; identical settings share one instance per process. */
export type ParquetDuckdbSettings = {
  /** DuckDB worker threads. Default 2 — the writer is a background encoder, not a query engine. */
  threads?: number
  /** DuckDB memory_limit (e.g. '2GB'). Bounds the in-memory staging tables. Default '2GB'. */
  memoryLimit?: string
}

export const DEFAULT_DUCKDB_THREADS = 2
export const DEFAULT_DUCKDB_MEMORY_LIMIT = '2GB'

let apiPromise: Promise<DuckdbApi> | undefined
const instances = new Map<string, Promise<DuckDBInstance>>()

/** Loads (once) the optional `@duckdb/node-api` module, failing with an actionable error. */
export function loadDuckdbApi(): Promise<DuckdbApi> {
  apiPromise ??= import('@duckdb/node-api').catch((error) => {
    apiPromise = undefined

    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.DUCKDB_UNAVAILABLE,
      `parquetTarget: engine 'duckdb' requires the optional peer dependency '@duckdb/node-api'. ` +
        `Install it (\`pnpm add @duckdb/node-api\`) or remove settings.engine to use the default ` +
        `parquetjs engine. Original error: ${error instanceof Error ? error.message : String(error)}`,
    )
  })

  return apiPromise
}

/**
 * One shared in-memory DuckDB instance per process per distinct config — segment writers are
 * appender/COPY workloads, and a single bounded instance keeps the process's native thread and
 * memory footprint fixed no matter how many tables or targets a pipe declares.
 */
export function acquireDuckdbInstance(settings?: ParquetDuckdbSettings): Promise<DuckDBInstance> {
  const threads = settings?.threads ?? DEFAULT_DUCKDB_THREADS
  const memoryLimit = settings?.memoryLimit ?? DEFAULT_DUCKDB_MEMORY_LIMIT
  const key = `${threads}|${memoryLimit}`

  let instance = instances.get(key)
  if (!instance) {
    instance = loadDuckdbApi().then((api) =>
      api.DuckDBInstance.create(':memory:', { threads: String(threads), memory_limit: memoryLimit }),
    )
    instances.set(key, instance)
    // A failed create must not poison the cache slot for retries.
    instance.catch(() => {
      if (instances.get(key) === instance) instances.delete(key)
    })
  }

  return instance
}
