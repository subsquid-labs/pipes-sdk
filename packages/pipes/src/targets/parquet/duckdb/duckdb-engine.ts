import { DuckDBInstance } from '@duckdb/node-api'

/** Tuning for the shared DuckDB instance; identical settings share one instance per process. */
export type ParquetDuckdbSettings = {
  /** DuckDB worker threads. Default 2 — the writer is a background encoder, not a query engine. */
  threads?: number
  /** DuckDB memory_limit (e.g. '2GB'). Bounds the in-memory staging tables. Default '2GB'. */
  memoryLimit?: string
}

export const DEFAULT_DUCKDB_THREADS = 2
export const DEFAULT_DUCKDB_MEMORY_LIMIT = '2GB'

const instances = new Map<string, Promise<DuckDBInstance>>()

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
    instance = DuckDBInstance.create(':memory:', { threads: String(threads), memory_limit: memoryLimit })
    instances.set(key, instance)
    // A failed create must not poison the cache slot for retries.
    instance.catch(() => {
      if (instances.get(key) === instance) instances.delete(key)
    })
  }

  return instance
}
