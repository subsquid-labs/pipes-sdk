import { type ClickHouseClient, createClient } from '@clickhouse/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse } from 'yaml'

export type ClickHouseServerConfig = {
  name: string
  url: string
  username: string
  password: string
  database: string
}

const SERVER_DEFAULTS = {
  name: 'Default',
  url: 'http://localhost:8123',
  username: 'default',
  password: '',
  database: 'default',
}

function loadFromYaml(): ClickHouseServerConfig[] | null {
  const configPath = process.env.CLICKHOUSE_CONFIG ?? join(process.cwd(), 'config.yaml')
  let content: string
  try {
    content = readFileSync(configPath, 'utf-8')
  } catch {
    return null
  }
  try {
    const parsed = parse(content)
    const entries: any[] = parsed?.db?.clickhouse
    if (!Array.isArray(entries) || entries.length === 0) return null
    return entries.map((e, i) => ({
      name: e.name ?? `Instance ${i + 1}`,
      url: e.url ?? SERVER_DEFAULTS.url,
      username: e.username ?? SERVER_DEFAULTS.username,
      password: e.password ?? SERVER_DEFAULTS.password,
      database: e.database ?? SERVER_DEFAULTS.database,
    }))
  } catch (err) {
    console.error(`Failed to parse config YAML at ${configPath}:`, err)
    return null
  }
}

function loadFromEnv(): ClickHouseServerConfig[] {
  const raw = process.env.CLICKHOUSE_SERVERS
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((e: any, i: number) => ({
          name: e.name ?? `Instance ${i + 1}`,
          url: e.url ?? SERVER_DEFAULTS.url,
          username: e.username ?? SERVER_DEFAULTS.username,
          password: e.password ?? SERVER_DEFAULTS.password,
          database: e.database ?? SERVER_DEFAULTS.database,
        }))
      }
    } catch {
      console.error('Failed to parse CLICKHOUSE_SERVERS env var')
    }
  }
  return [
    {
      name: process.env.CLICKHOUSE_NAME ?? SERVER_DEFAULTS.name,
      url: process.env.CLICKHOUSE_URL ?? SERVER_DEFAULTS.url,
      username: process.env.CLICKHOUSE_USER ?? SERVER_DEFAULTS.username,
      password: process.env.CLICKHOUSE_PASSWORD ?? SERVER_DEFAULTS.password,
      database: process.env.CLICKHOUSE_DATABASE ?? SERVER_DEFAULTS.database,
    },
  ]
}

let servers: ClickHouseServerConfig[] | null = null

/**
 * Resolution order:
 * 1. YAML config file (CLICKHOUSE_CONFIG env var or ./config.yaml)
 * 2. CLICKHOUSE_SERVERS env var (JSON array)
 * 3. Individual env vars (CLICKHOUSE_URL, CLICKHOUSE_USER, etc.)
 */
export function getServers(): ClickHouseServerConfig[] {
  if (!servers) {
    servers = loadFromYaml() ?? loadFromEnv()
  }
  return servers
}

export function getServerList(): { name: string; index: number }[] {
  return getServers().map((s, i) => ({ name: s.name, index: i }))
}

const clients = new Map<number, ClickHouseClient>()

export function getClickHouseClient(serverIndex = 0): ClickHouseClient {
  let client = clients.get(serverIndex)
  if (!client) {
    const config = getServers()[serverIndex]
    if (!config) {
      throw new Error(`No ClickHouse server configured at index ${serverIndex}`)
    }
    client = createClient({
      url: config.url,
      username: config.username,
      password: config.password,
      database: config.database,
    })
    clients.set(serverIndex, client)
  }
  return client
}

export * from './queries/clickhouse-version'
export * from './queries/executed-queries'
export * from './queries/table-columns'
export * from './queries/table-definition'
export * from './queries/tables-list'
