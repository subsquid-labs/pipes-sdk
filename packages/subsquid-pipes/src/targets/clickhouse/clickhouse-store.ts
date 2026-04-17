import type {
  ClickHouseClient,
  CommandParams,
  CommandResult,
  DataFormat,
  InsertParams,
  InsertResult,
  QueryParams,
  QueryResult,
} from '@clickhouse/client'

import type { BlockCursor, Logger } from '~/core/index.js'

import {
  ColumnIntrospector,
  type RollbackReason,
  type RollbackResult,
  resolveTargetTable,
  runMonolithicCleanup,
} from './clickhouse-rollback.js'
import { loadSqlFiles } from './fs.js'

export type QueryParamsWithFormat<Format extends DataFormat> = Omit<QueryParams, 'format'> & {
  format?: Format
}

/** Legacy `removeAllRows` shape, preserved as a shim with a deprecation warning. */
export type LegacyRemoveAllRowsArgs = {
  tables: string | string[]
  where: string
  params?: Record<string, unknown>
}

/** Structured `removeAllRows` shape introduced by Phase 1 of SDKTL-52. */
export type StructuredRemoveAllRowsArgs = {
  tables: string | string[]
  scopeWhere?: string
  params?: Record<string, unknown>
  cursorColumn?: string
  safeCursor?: BlockCursor
  reason?: RollbackReason
}

export type RemoveAllRowsArgs = LegacyRemoveAllRowsArgs | StructuredRemoveAllRowsArgs

function isLegacy(args: RemoveAllRowsArgs): args is LegacyRemoveAllRowsArgs {
  return 'where' in args && typeof (args as LegacyRemoveAllRowsArgs).where === 'string'
}

export class ClickhouseStore {
  #shimWarned = false
  #introspector?: ColumnIntrospector
  #defaultDb?: string

  constructor(public client: ClickHouseClient) {}

  insert<T>(params: InsertParams<T>): Promise<InsertResult> {
    return this.client.insert(params as any)
  }

  query<Format extends DataFormat = 'JSON'>(params: QueryParamsWithFormat<Format>): Promise<QueryResult<Format>> {
    return this.client.query(params)
  }

  command(params: CommandParams): Promise<CommandResult> {
    return this.client.command(params)
  }

  close() {
    return this.client.close()
  }

  // FIXME use glob
  async executeFiles(dir: string) {
    const queries = await loadSqlFiles(dir)

    for (const query of queries) {
      try {
        await this.client.command({ query })
      } catch (e: any) {
        console.error(e)

        process.exit(1)
      }
    }
  }

  /**
   * Removes all rows matching a scope via CollapsingMergeTree tombstone
   * insertion. Two call shapes:
   *
   * - **Legacy**: `{ tables, where, params? }`. Preserved for back-compat;
   *   emits a one-time deprecation warning per store instance.
   * - **Structured** (recommended): `{ tables, scopeWhere?, params?, cursorColumn?, safeCursor?, reason? }`.
   *   Runs a single server-side `INSERT INTO t (cols, sign) SELECT cols, -1 FROM t FINAL WHERE <scope>`.
   *   No rows stream through Node.
   */
  async removeAllRows(args: RemoveAllRowsArgs, opts?: { logger?: Logger }): Promise<RollbackResult[]> {
    if (isLegacy(args)) {
      if (!this.#shimWarned) {
        this.#shimWarned = true
        opts?.logger?.warn?.(
          'removeAllRows({ where }) is deprecated; pass { scopeWhere, cursorColumn, safeCursor, reason } to get EXISTS short-circuit and chunked+resumable rollback.',
        )
      }
      return this.#runStructured({
        tables: args.tables,
        scopeWhere: args.where,
        params: args.params,
      })
    }
    return this.#runStructured(args)
  }

  async #runStructured(args: StructuredRemoveAllRowsArgs): Promise<RollbackResult[]> {
    const tables = typeof args.tables === 'string' ? [args.tables] : args.tables
    const introspector = this.#getIntrospector()
    const defaultDb = this.#getDefaultDb()
    const scopeWhere = args.scopeWhere ?? '1'

    const results: RollbackResult[] = []
    for (const rawTable of tables) {
      const { db, unqualifiedTable, qualifiedTable } = resolveTargetTable(rawTable, defaultDb)
      const result = await runMonolithicCleanup({
        store: this,
        introspector,
        db,
        table: qualifiedTable,
        unqualifiedTable,
        scopeWhere,
        queryParams: args.params,
      })
      results.push(result)
    }
    return results
  }

  async removeAllRowsByQuery({
    table,
    query,
    params,
  }: {
    table: string
    query: string
    params?: Record<string, unknown>
  }) {
    let count = 0
    const res = await this.client.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        date_time_output_format: 'iso',
        output_format_json_quote_64bit_floats: 1,
        output_format_json_quote_64bit_integers: 1,
      },
      query_params: params,
    })

    for await (const rows of res.stream()) {
      await this.client.insert({
        table,
        values: rows.map((row: any) => {
          const data = row.json()

          data.sign = -1

          return data
        }),
        format: 'JSONEachRow',
        clickhouse_settings: {
          date_time_input_format: 'best_effort',
        },
      })

      count += rows.length
    }

    return count
  }

  #getIntrospector(): ColumnIntrospector {
    this.#introspector ??= new ColumnIntrospector(this)
    return this.#introspector
  }

  #getDefaultDb(): string {
    if (this.#defaultDb) return this.#defaultDb
    const anyClient = this.client as any
    const db = anyClient?.connectionParams?.database || 'default'
    this.#defaultDb = db
    return db
  }
}
