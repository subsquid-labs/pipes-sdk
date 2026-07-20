import { DuckDBInstance } from '@duckdb/node-api'

import type { ParquetEngine } from '../engine.js'
import { validateDuckdbTableCompression } from './duckdb-schema.js'
// Deferred cycle with duckdb-writer.js (it imports `acquireDuckdbInstance` back): both sides
// only touch the other's bindings inside function bodies, never at module evaluation.
import { DuckdbSegmentWriter, SegmentSizeEstimator } from './duckdb-writer.js'

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

/** The duckdb engine handle: a {@link ParquetEngine} whose resolved settings are inspectable. */
export type DuckdbEngine = ParquetEngine & { readonly settings: Required<ParquetDuckdbSettings> }

/**
 * DuckDB-backed engine: stages rows in an in-memory DuckDB table and COPYs each segment to
 * Parquet natively. The win over parquetjs is native encoding efficiency (~2× less write-path
 * CPU on typical flat schemas) — for common codecs (SNAPPY/GZIP) the COPY still runs mostly on
 * the calling JS thread; only expensive codecs (BROTLI) measurably parallelize onto DuckDB's
 * worker threads. See `docs/benchmarks/2026-07-16-parquet-engine-deep-bench.md`.
 * Requires the `@duckdb/node-api` peer — install it and import this engine from
 * `@subsquid/pipes/targets/parquet/duckdb`. Identical settings share one process-wide
 * DuckDB instance.
 */
export function duckdbEngine(settings?: ParquetDuckdbSettings): DuckdbEngine {
  const resolved = {
    threads: settings?.threads ?? DEFAULT_DUCKDB_THREADS,
    memoryLimit: settings?.memoryLimit ?? DEFAULT_DUCKDB_MEMORY_LIMIT,
  }

  return {
    name: 'duckdb',
    settings: resolved,
    table(table, context) {
      validateDuckdbTableCompression(table, context.codec)

      // Bytes/row calibration survives across this table's successive segments (rotation memory).
      const estimator = new SegmentSizeEstimator()

      return {
        createSegment: () =>
          new DuckdbSegmentWriter({
            dir: context.dir,
            columns: table.schema,
            rowGroupSize: context.rowGroupSize,
            codec: context.codec,
            duckdb: resolved,
            estimator,
          }),
      }
    },
  }
}
