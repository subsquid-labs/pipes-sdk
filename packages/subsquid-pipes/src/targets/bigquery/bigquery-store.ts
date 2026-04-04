import type { BigQuery } from '@google-cloud/bigquery'

/**
 * Thin wrapper around the BigQuery client for out-of-transaction DDL and reads.
 * All in-transaction data writes go through BigQuerySession directly.
 */
export class BigQueryStore {
  constructor(
    private bq: BigQuery,
    readonly dataset: string,
  ) {}

  async ddl(sql: string): Promise<void> {
    await this.bq.query({ query: sql, useLegacySql: false })
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const [rows] = await this.bq.query({ query: sql, params, useLegacySql: false })
    return rows as T[]
  }
}
