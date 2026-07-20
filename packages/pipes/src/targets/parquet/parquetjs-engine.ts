import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'

/**
 * The dynamically-imported module namespace. The parquetjs engine keeps `@dsnp/parquetjs` OUT
 * of its top-level runtime imports (type-only imports are erased), so
 * `import '@subsquid/pipes/targets/parquet'` works without the optional dependency — this
 * module's `import()` below is the single load point, reached only when a parquetjs segment
 * actually opens.
 */
export type ParquetjsApi = typeof import('@dsnp/parquetjs')

let apiPromise: Promise<ParquetjsApi> | undefined

/** Loads (once) the optional `@dsnp/parquetjs` module, failing with an actionable error. */
export function loadParquetjs(): Promise<ParquetjsApi> {
  apiPromise ??= import('@dsnp/parquetjs').catch((error) => {
    apiPromise = undefined

    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.PARQUETJS_UNAVAILABLE,
      `parquetTarget: the default 'parquetjs' engine requires the optional peer dependency ` +
        `'@dsnp/parquetjs'. Install it (\`pnpm add @dsnp/parquetjs\`) or select a different ` +
        `engine via settings.engine. Original error: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    )
  })

  return apiPromise
}
