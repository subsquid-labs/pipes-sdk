import { useQuery } from '@tanstack/react-query'

import { client } from '~/api/client'
import { useServerIndex } from '~/api/server-context'

// Types

export type ClickhouseServer = {
  name: string
  index: number
}

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

export type QueryLogWindow = '15m' | '1h' | '4h' | '1d'

export type QueryLogRow = {
  query_hash: string
  user: string
  query: string
  avg_user_time_secs: number
  total_user_time_secs: number
  avg_system_time_secs: number
  total_system_time_secs: number
  avg_real_time_secs: number
  total_real_time_secs: number
  count: number
}

export type QueryDetails = {
  query_hash: string
  event_time: string
  user: string
  query_id: string
  query_kind: string
  query: string
  profile: Record<string, number>
  user_time_secs: number
  system_time_secs: number
  real_time_secs: number
  query_duration_ms: number
  read_rows: number
  read_bytes: number
  result_rows: number
  result_bytes: number
  written_rows: number
  written_bytes: number
  memory_usage: number
}

export type QueryExplainResult = {
  plan: string | null
  planError: string | null
  pipeline: string | null
  pipelineError: string | null
}

// Query log window utilities

const WINDOWS: Record<string, { label: string }> = {
  '15m': { label: '15 mins' },
  '1h': { label: '1 hour' },
  '4h': { label: '4 hours' },
  '1d': { label: '1 day' },
}

export function parseQueryLogWindow(input: string | null | undefined): QueryLogWindow {
  return input && input in WINDOWS ? (input as QueryLogWindow) : '1h'
}

export function queryLogWindowLabel(window: QueryLogWindow): string {
  return WINDOWS[window].label
}

// Hooks

export function useServers() {
  return useQuery({
    queryKey: ['clickhouse/servers'],
    queryFn: async () => {
      const res = await client.get<{ servers: ClickhouseServer[] }>('/api/servers')
      return res.data.servers
    },
    retry: false,
  })
}

export function useClickhouseVersion() {
  const { serverIndex } = useServerIndex()
  return useQuery({
    queryKey: ['clickhouse/version', serverIndex],
    queryFn: async () => {
      const res = await client.get<{ version: string | null }>(`/api/version?_server=${serverIndex}`)
      return res.data.version
    },
    retry: false,
  })
}

export function useTables() {
  const { serverIndex } = useServerIndex()
  return useQuery({
    queryKey: ['clickhouse/tables', serverIndex],
    queryFn: async () => {
      const res = await client.get<{ tables: ClickhouseTableRow[] }>(`/api/tables?_server=${serverIndex}`)
      return res.data.tables
    },
    retry: false,
  })
}

export function useTableColumns(database: string, table: string) {
  const { serverIndex } = useServerIndex()
  return useQuery({
    queryKey: ['clickhouse/table-columns', serverIndex, database, table],
    queryFn: async () => {
      const res = await client.get<{ columns: TableColumnStat[] }>(
        `/api/tables/${encodeURIComponent(database)}/${encodeURIComponent(table)}/columns?_server=${serverIndex}`,
      )
      return res.data.columns
    },
    retry: false,
  })
}

export function useTableDefinition(database: string, table: string) {
  const { serverIndex } = useServerIndex()
  return useQuery({
    queryKey: ['clickhouse/table-definition', serverIndex, database, table],
    queryFn: async () => {
      const res = await client.get<{ definition: string | null }>(
        `/api/tables/${encodeURIComponent(database)}/${encodeURIComponent(table)}/definition?_server=${serverIndex}`,
      )
      return res.data.definition
    },
    retry: false,
  })
}

export function useRecentQueries(interval?: QueryLogWindow) {
  const { serverIndex } = useServerIndex()
  return useQuery({
    queryKey: ['clickhouse/queries', serverIndex, interval],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('_server', String(serverIndex))
      if (interval) params.set('interval', interval)
      const res = await client.get<{ queries: QueryLogRow[] }>(`/api/queries?${params}`)
      return res.data.queries
    },
    retry: false,
  })
}

export function useQueryDetails(hash: string) {
  const { serverIndex } = useServerIndex()
  return useQuery({
    queryKey: ['clickhouse/query-details', serverIndex, hash],
    queryFn: async () => {
      const res = await client.get<{ details: QueryDetails | null }>(`/api/queries/${hash}?_server=${serverIndex}`)
      return res.data.details
    },
    enabled: /^\d+$/.test(hash),
    retry: false,
  })
}

export function useQueryExplain(hash: string, { enabled = true }: { enabled?: boolean } = {}) {
  const { serverIndex } = useServerIndex()
  return useQuery({
    queryKey: ['clickhouse/query-explain', serverIndex, hash],
    queryFn: async () => {
      const res = await client.get<QueryExplainResult>(`/api/queries/${hash}/explain?_server=${serverIndex}`)
      return res.data
    },
    enabled: enabled && /^\d+$/.test(hash),
    retry: false,
  })
}
