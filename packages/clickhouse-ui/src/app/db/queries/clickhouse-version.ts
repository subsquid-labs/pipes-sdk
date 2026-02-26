import { getClickHouseClient } from '../clickhouse'

export async function fetchClickhouseVersion(serverIndex?: number): Promise<string | null> {
  const client = getClickHouseClient(serverIndex)
  const resultSet = await client.query({
    query: 'SELECT version() AS version',
    format: 'JSONEachRow',
  })
  const json = (await resultSet.json()) as any[]
  const version = json?.[0]?.version
  return version ? String(version) : null
}
