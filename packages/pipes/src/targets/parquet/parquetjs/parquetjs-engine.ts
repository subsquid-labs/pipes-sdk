import { ParquetSchema } from '@dsnp/parquetjs'

import type { ParquetEngine } from '../engine.js'
import type { Codec } from '../schema.js'
import { buildRowWrapper, toParquetSchemaShape } from './parquetjs-schema.js'
import { ParquetSegmentWriter } from './parquetjs-writer.js'

/**
 * Encoding options for the parquetjs engine — typed to what this engine can actually do.
 * Encoding is engine-owned: the target neither consumes nor forwards these.
 */
export type ParquetjsEngineOptions = {
  /**
   * Rows per row group — a row count, not bytes. Writer-side it is the in-memory flush
   * threshold (how many rows are buffered before a row group is encoded to disk), reader-side
   * the pruning granularity. It bounds this engine's staging memory. Default 100_000.
   */
  rowGroupSize?: number
  /**
   * Compression codec for columns that do not declare their own. Individual columns may
   * override it via `column.compression` in the declared schema — this engine honors
   * per-column overrides. Default `'SNAPPY'`.
   */
  compression?: Codec
}

/** Default rows per row group — the in-memory "split size" that bounds writer memory. */
export const DEFAULT_ROW_GROUP_SIZE = 100_000
export const DEFAULT_COMPRESSION: Codec = 'SNAPPY'

/**
 * The default engine: writes segments with `@dsnp/parquetjs` on the JS thread. Requires the
 * `@dsnp/parquetjs` peer — the core `@subsquid/pipes/targets/parquet` entry imports it
 * statically, so a missing install fails at import time.
 *
 * Per-table state compiled once and shared by every segment of that table: the library
 * schema and the LIST row wrapper.
 */
export function parquetjsEngine(options: ParquetjsEngineOptions = {}): ParquetEngine {
  const rowGroupSize = options.rowGroupSize ?? DEFAULT_ROW_GROUP_SIZE
  const compression = options.compression ?? DEFAULT_COMPRESSION

  return {
    name: 'parquetjs',
    table(table) {
      const schema = new ParquetSchema(toParquetSchemaShape(table, compression))
      const wrapRow = buildRowWrapper(table.schema)

      return {
        createSegment: (tmpPath) =>
          new ParquetSegmentWriter({
            tmpPath,
            schema,
            rowGroupSize,
            wrapRow,
          }),
      }
    },
  }
}
