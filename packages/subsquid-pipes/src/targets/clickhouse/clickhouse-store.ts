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
import { loadSqlFiles } from './fs'

export type QueryParamsWithFormat<Format extends DataFormat> = Omit<QueryParams, 'format'> & {
  format?: Format
}

export class ClickhouseStore {
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

  async removeAllRows({
    tables,
    params,
    where,
  }: {
    tables: string | string[]
    where: string
    params?: Record<string, unknown>
  }) {
    tables = typeof tables === 'string' ? [tables] : tables

    await Promise.all(
      tables.map(async (table) => {
        // TODO check engine

        const count = await this.removeAllRowsByQuery({
          table,
          query: `SELECT * FROM ${table} FINAL WHERE ${where}`,
          params,
        })

        return { table, count }
      }),
    )
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
}
