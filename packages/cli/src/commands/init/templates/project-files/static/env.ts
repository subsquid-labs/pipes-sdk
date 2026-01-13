import { Sink } from "~/types/init.js"

export const clickhouseEnvTemplate = `CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=pipes
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=password
`

export const postgresEnvTemplate = `DB_CONNECTION_STR=postgresql://postgres:password@localhost:5432/pipes
`

export function getEnvTemplate(sink: Sink): string {
  return sink === 'clickhouse' ? clickhouseEnvTemplate : postgresEnvTemplate
}
