import { getClickHouseClient } from '../clickhouse'

export const TABLE_DEFINITION_QUERY = `
SHOW CREATE TABLE {database:Identifier}.{table:Identifier}
`

export async function fetchTableDefinition(database: string, table: string): Promise<string | null> {
  const client = getClickHouseClient()
  const resultSet = await client.query({
    query: TABLE_DEFINITION_QUERY,
    format: 'TabSeparatedRaw',
    query_params: {
      database,
      table,
    },
  })

  const text = await resultSet.text()
  const trimmed = text.trim()
  return trimmed.length ? trimmed : null
}
