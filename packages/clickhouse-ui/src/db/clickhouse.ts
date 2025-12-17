import { type ClickHouseClient, createClient } from '@clickhouse/client'

let client: ClickHouseClient | null = null

export function getClickHouseClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER ?? 'default',
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
      database: process.env.CLICKHOUSE_DATABASE ?? 'default',
    })
  }
  return client
}

export * from './queries/clickhouse-version'
export * from './queries/executed-queries'
export * from './queries/table-columns'
export * from './queries/table-definition'
export * from './queries/tables-list'
