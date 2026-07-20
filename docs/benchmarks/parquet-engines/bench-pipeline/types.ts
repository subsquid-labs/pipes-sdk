import type { Target } from '../../../../packages/pipes/src/core/index.js'
import type { ParquetTable } from '../../../../packages/pipes/src/targets/parquet/index.js'

export type Row = Record<string, unknown>

export type BenchRange = { from: number; to: number }

export type StreamOptions = {
  /** SQLite portal-cache file; records on miss, replays on hit. */
  cachePath?: string
  /** Override the indexer's default block range. */
  range?: BenchRange
  /** Override the portal URL (tests point this at a mock portal). */
  portal?: string
}

/** Portal stream of mapped row batches — supports pipeTo(parquetTarget) and async iteration. */
export type RowStream = {
  pipeTo(target: Target<Row[]>): Promise<void>
  [Symbol.asyncIterator](): AsyncIterator<{ data: Row[] }>
}

export type BenchIndexer = {
  /** Unique id, e.g. 'btc-transactions'. Used as pipe id, cache file name, CLI key. */
  id: string
  portalUrl: string
  /** Default range sized to produce a benchmark-meaningful row count. */
  range: BenchRange
  table: ParquetTable
  createStream(opts?: StreamOptions): RowStream
}
