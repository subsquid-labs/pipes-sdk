import { Sink } from "~/types/init.js"

export const clickhouseEnvTemplate = `
import { z } from 'zod'

const env = z.object({
  CLICKHOUSE_USER: z.string(),
  CLICKHOUSE_PASSWORD: z.string(),
  CLICKHOUSE_URL: z.string(),
}).parse(process.env)
`

export const postgresEnvTemplate = `
import { z } from 'zod'

const env = z.object({
  DB_CONNECTION_STR: z.string(),
}).parse(process.env)
`

export function getEnvTemplate(sink: Sink): string {
  if (sink === 'clickhouse') return clickhouseEnvTemplate
  else if (sink === 'postgresql') return postgresEnvTemplate
  else if (sink === 'memory') throw new Error('Memory not implemented')
  else throw new Error(`Sink type ${sink} does not exist or its template not implemented`)
}