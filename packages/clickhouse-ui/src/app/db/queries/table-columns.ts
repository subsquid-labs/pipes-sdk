import { getClickHouseClient } from '../clickhouse'

export const TABLE_COLUMNS_QUERY = `
SELECT
    database,
    table,
    column,
    formatReadableSize(sum(column_data_compressed_bytes)) AS compressed_size,
    formatReadableSize(sum(column_data_uncompressed_bytes)) AS uncompressed_size,
    round(sum(column_data_uncompressed_bytes) / sum(column_data_compressed_bytes), 2) AS compression_ratio,
    sum(rows) AS total_rows,
    round(sum(column_data_uncompressed_bytes) / sum(rows), 2) AS avg_bytes_per_row_uncompressed
FROM
    system.parts_columns
WHERE
    active = 1
  AND database = {database:String}
  AND table = {table:String}
GROUP BY
    database,
    table,
    column
ORDER BY
    sum(column_data_compressed_bytes) DESC;
`

export type TableColumnStat = {
  database: string
  table: string
  column: string
  compressed_size: string
  uncompressed_size: string
  compression_ratio: number
  total_rows: string
  avg_bytes_per_row_uncompressed: number
}

export async function fetchTableColumns(
  database: string,
  table: string,
  serverIndex?: number,
): Promise<TableColumnStat[]> {
  const client = getClickHouseClient(serverIndex)
  const resultSet = await client.query({
    query: TABLE_COLUMNS_QUERY,
    format: 'JSONEachRow',
    query_params: {
      database,
      table,
    },
  })

  const rows = (await resultSet.json()) as TableColumnStat[]
  return rows
}
