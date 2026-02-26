import { getClickHouseClient } from '../clickhouse'

export type QueryLogWindow = '15m' | '1h' | '4h' | '1d'

export const DEFAULT_QUERY_LOG_WINDOW: QueryLogWindow = '1h'

const WINDOWS: Record<string, { label: string; seconds: number }> = {
  '15m': { label: '15 mins', seconds: 15 * 60 },
  '1h': { label: '1 hour', seconds: 60 * 60 },
  '4h': { label: '4 hours', seconds: 4 * 60 * 60 },
  '1d': { label: '1 day', seconds: 24 * 60 * 60 },
}

export function parseQueryLogWindow(input: string | string[] | undefined): QueryLogWindow {
  const value = Array.isArray(input) ? input[0] : input
  return value && Object.prototype.hasOwnProperty.call(WINDOWS, value)
    ? (value as QueryLogWindow)
    : DEFAULT_QUERY_LOG_WINDOW
}

export function queryLogWindowSeconds(window: QueryLogWindow): number {
  return WINDOWS[window].seconds
}

export function queryLogWindowLabel(window: QueryLogWindow): string {
  return WINDOWS[window].label
}

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

export const QUERY_LOG_RECENT = `
WITH
    indexOf(ProfileEvents.Names, 'UserTimeMicroseconds') AS user_time_idx,
    indexOf(ProfileEvents.Names, 'SystemTimeMicroseconds') AS system_time_idx,
    indexOf(ProfileEvents.Names, 'RealTimeMicroseconds') AS real_time_idx
SELECT
    toString(normalized_query_hash) AS query_hash,
    user,
    any(query) as query,

    avg(if(user_time_idx = 0, 0, ProfileEvents.Values[user_time_idx])) / 1000000 AS avg_user_time_secs,
    sum(if(user_time_idx = 0, 0, ProfileEvents.Values[user_time_idx])) / 1000000 AS total_user_time_secs,

    avg(if(system_time_idx = 0, 0, ProfileEvents.Values[system_time_idx])) / 1000000 AS avg_system_time_secs,
    sum(if(system_time_idx = 0, 0, ProfileEvents.Values[system_time_idx])) / 1000000 AS total_system_time_secs,

    avg(if(real_time_idx = 0, 0, ProfileEvents.Values[real_time_idx])) / 1000000 AS avg_real_time_secs,
    sum(if(real_time_idx = 0, 0, ProfileEvents.Values[real_time_idx])) / 1000000 AS total_real_time_secs,
    count() as count
FROM system.query_log
WHERE event_time > now() - toIntervalSecond({windowSeconds:UInt32})
GROUP BY user, normalized_query_hash
ORDER BY total_real_time_secs DESC

`

export async function fetchRecentQueries(
  window: QueryLogWindow = DEFAULT_QUERY_LOG_WINDOW,
  serverIndex?: number,
): Promise<QueryLogRow[]> {
  const client = getClickHouseClient(serverIndex)
  const resultSet = await client.query({
    query: QUERY_LOG_RECENT,
    format: 'JSONEachRow',
    query_params: {
      windowSeconds: queryLogWindowSeconds(window),
    },
  })

  const raw = (await resultSet.json()) as any[]

  return raw.map((r: any) => ({
    query_hash: String(r.query_hash ?? ''),
    user: String(r.user ?? ''),
    query: String(r.query ?? '').trim(),
    avg_user_time_secs: Number(r.avg_user_time_secs ?? 0),
    total_user_time_secs: Number(r.total_user_time_secs ?? 0),
    avg_system_time_secs: Number(r.avg_system_time_secs ?? 0),
    total_system_time_secs: Number(r.total_system_time_secs ?? 0),
    avg_real_time_secs: Number(r.avg_real_time_secs ?? 0),
    total_real_time_secs: Number(r.total_real_time_secs ?? 0),
    count: Number(r.count ?? 0),
  }))
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

export async function fetchLatestQueryByHash(queryHash: string, serverIndex?: number): Promise<QueryDetails | null> {
  const client = getClickHouseClient(serverIndex)
  const resultSet = await client.query({
    query: `
WITH
    indexOf(ProfileEvents.Names, 'UserTimeMicroseconds') AS user_time_idx,
    indexOf(ProfileEvents.Names, 'SystemTimeMicroseconds') AS system_time_idx,
    indexOf(ProfileEvents.Names, 'RealTimeMicroseconds') AS real_time_idx,
    if(real_time_idx = 0, 0, ProfileEvents.Values[real_time_idx]) AS real_time_us
SELECT
    toString(normalized_query_hash) AS query_hash,
    toString(event_time) AS event_time,
    user,
    query_id,
    toString(query_kind) AS query_kind,
    query,
    type,
    query_duration_ms,
    read_rows,
    read_bytes,
    result_rows,
    result_bytes,
    written_rows,
    written_bytes,
    memory_usage,
    ProfileEvents.Names AS profile_names,
    ProfileEvents.Values AS profile_values,
    if(user_time_idx = 0, 0, ProfileEvents.Values[user_time_idx]) / 1000000 AS user_time_secs,
    if(system_time_idx = 0, 0, ProfileEvents.Values[system_time_idx]) / 1000000 AS system_time_secs,
    real_time_us / 1000000 AS real_time_secs
FROM system.query_log
WHERE type = 'QueryFinish'
  AND normalized_query_hash = toUInt64({queryHash:String})
ORDER BY real_time_us DESC, event_time DESC
LIMIT 1
`,
    format: 'JSONEachRow',
    query_params: {
      queryHash,
    },
  })

  const raw = ((await resultSet.json()) as any[])[0]
  if (!raw) return null

  const profileNames: any[] = Array.isArray(raw.profile_names) ? raw.profile_names : []
  const profileValues: any[] = Array.isArray(raw.profile_values) ? raw.profile_values : []
  const profile: Record<string, number> = {}
  for (let i = 0; i < Math.min(profileNames.length, profileValues.length); i++) {
    const name = String(profileNames[i] ?? '')
    if (!name) continue
    profile[name] = Number(profileValues[i] ?? 0)
  }

  return {
    query_hash: String(raw.query_hash ?? ''),
    event_time: String(raw.event_time ?? ''),
    user: String(raw.user ?? ''),
    query_id: String(raw.query_id ?? ''),
    query_kind: String(raw.query_kind ?? ''),
    query: String(raw.query ?? '').trim(),
    profile,
    user_time_secs: Number(raw.user_time_secs ?? 0),
    system_time_secs: Number(raw.system_time_secs ?? 0),
    real_time_secs: Number(raw.real_time_secs ?? 0),
    query_duration_ms: Number(raw.query_duration_ms ?? 0),
    read_rows: Number(raw.read_rows ?? 0),
    read_bytes: Number(raw.read_bytes ?? 0),
    result_rows: Number(raw.result_rows ?? 0),
    result_bytes: Number(raw.result_bytes ?? 0),
    written_rows: Number(raw.written_rows ?? 0),
    written_bytes: Number(raw.written_bytes ?? 0),
    memory_usage: Number(raw.memory_usage ?? 0),
  }
}

function cleanQuery(sql: string) {
  return sql.replace(/\sFORMAT.+$/g, '')
}

export async function fetchExplainPlan(sql: string, serverIndex?: number): Promise<string> {
  const client = getClickHouseClient(serverIndex)
  const resultSet = await client.query({
    query: `EXPLAIN PLAN ${cleanQuery(sql)}`,
    format: 'TabSeparatedRaw',
  })

  return (await resultSet.text()).trim()
}

export async function fetchExplainPipeline(sql: string, serverIndex?: number): Promise<string> {
  const client = getClickHouseClient(serverIndex)
  const resultSet = await client.query({
    query: `EXPLAIN PIPELINE ${cleanQuery(sql)}`,
    format: 'TabSeparatedRaw',
  })
  return (await resultSet.text()).trim()
}
