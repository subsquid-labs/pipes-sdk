import { getClickHouseClient } from '../clickhouse'

export const LIST_TABLES_QUERY = `
select parts.*,
       columns.compressed_size,
       columns.uncompressed_size,
       columns.ratio
from (
         select database,
                table,
                formatReadableSize(sum(data_uncompressed_bytes))          AS uncompressed_size,
                formatReadableSize(sum(data_compressed_bytes))            AS compressed_size,
                sum(data_uncompressed_bytes) / sum(data_compressed_bytes) AS ratio
         from system.columns
         group by database, table
         ) columns
         right join (
    select database,
           table,
           sum(rows)                                            as rows,
           max(modification_time)                               as latest_modification,
           formatReadableSize(sum(bytes))                       as disk_size,
           formatReadableSize(sum(primary_key_bytes_in_memory)) as primary_keys_size,
           any(engine)                                          as engine,
           sum(bytes)                                           as bytes_size
    from system.parts
    where active
    group by database, table
    ) parts on (columns.database = parts.database and columns.table = parts.table)
order by parts.bytes_size desc;
`

export type ClickhouseTableRow = {
  database: string
  table: string
  rows: string
  latest_modification: string
  disk_size: string
  primary_keys_size: string
  engine: string
  bytes_size: string
  compressed_size: string | null
  uncompressed_size: string | null
  ratio: number | null
}

export async function fetchClickhouseTables(serverIndex?: number): Promise<ClickhouseTableRow[]> {
  const client = getClickHouseClient(serverIndex)

  const resultSet = await client.query({
    query: LIST_TABLES_QUERY,
    format: 'JSONEachRow',
  })

  const raw = (await resultSet.json()) as any[]

  // Normalize field types and ensure database/table are always strings
  const rows: ClickhouseTableRow[] = raw.map((r: any) => ({
    database: String(r['parts.database'] ?? r.database ?? ''),
    table: String(r['parts.table'] ?? r.table ?? ''),
    rows: String(r.rows ?? '0'),
    latest_modification: String(r.latest_modification ?? ''),
    disk_size: String(r.disk_size ?? ''),
    primary_keys_size: String(r.primary_keys_size ?? ''),
    engine: String(r.engine ?? ''),
    bytes_size: String(r.bytes_size ?? ''),
    compressed_size: r.compressed_size === null || r.compressed_size === undefined ? null : String(r.compressed_size),
    uncompressed_size:
      r.uncompressed_size === null || r.uncompressed_size === undefined ? null : String(r.uncompressed_size),
    ratio: r.ratio === null || r.ratio === undefined ? null : typeof r.ratio === 'number' ? r.ratio : Number(r.ratio),
  }))

  return rows
}
