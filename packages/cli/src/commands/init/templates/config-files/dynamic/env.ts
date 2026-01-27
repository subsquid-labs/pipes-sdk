import Mustache from 'mustache'
import { Sink } from '~/types/init.js'
import { clickhouseDefaults, postgresDefaults } from './docker-compose.js'

const clickhouseEnvTemplate = `CLICKHOUSE_URL=http://localhost:{{port}}
CLICKHOUSE_DATABASE={{db}}
CLICKHOUSE_USER={{user}}
CLICKHOUSE_PASSWORD={{password}}
`

const postgresEnvTemplate = `DB_CONNECTION_STR=postgresql://{{user}}:{{password}}@localhost:{{port}}/{{db}}`

interface EnvTemplateValues {
  sink: Sink
}

export function _renderEnvTemplate(values: EnvTemplateValues): string {
  const isPostgres = values.sink === 'postgresql'
  return Mustache.render(
    isPostgres ? postgresEnvTemplate : clickhouseEnvTemplate,
    isPostgres ? postgresDefaults : clickhouseDefaults,
  )
}
