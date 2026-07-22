import { ParquetSchema } from '@dsnp/parquetjs'

import type { ParquetEngine } from '../engine.js'
import { buildRowWrapper, toParquetSchemaShape } from './parquetjs-schema.js'
import { ParquetSegmentWriter } from './parquetjs-writer.js'

/**
 * The default engine: writes segments with `@dsnp/parquetjs` on the JS thread. Requires the
 * `@dsnp/parquetjs` peer — the core `@subsquid/pipes/targets/parquet` entry imports it
 * statically, so a missing install fails at import time.
 *
 * Per-table state compiled once and shared by every segment of that table: the library
 * schema and the LIST row wrapper.
 */
export function parquetjsEngine(): ParquetEngine {
  return {
    name: 'parquetjs',
    table(table, context) {
      const schema = new ParquetSchema(toParquetSchemaShape(table, context.defaultCompression))
      const wrapRow = buildRowWrapper(table.schema)

      return {
        createSegment: (tmpPath) =>
          new ParquetSegmentWriter({
            tmpPath,
            schema,
            rowGroupSize: context.rowGroupSize,
            wrapRow,
          }),
      }
    },
  }
}
