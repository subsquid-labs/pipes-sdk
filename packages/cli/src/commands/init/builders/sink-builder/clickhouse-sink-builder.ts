import Mustache from 'mustache'

import type { Config, NetworkType } from '~/types/init.js'

import { clickhouseDefaults } from '../../templates/config-files/dynamic/docker-compose.js'
import { groupContractsForDecoders } from '../../templates/pipes/evm/custom/decoder-grouping.js'
import type { SinkArtifacts, SinkFile } from './sink-artifacts.js'
import { extractCreateTableNames, tableName as chTableName } from './shared.js'

const sinkTemplate = `
import path from 'node:path'
import { clickhouseTarget } from '@subsquid/pipes/targets/clickhouse'
import { createClient } from '@clickhouse/client'
import { serializeJsonWithBigInt, toSnakeKeysArray } from './utils/index.js'

clickhouseTarget({
    client: createClient({
        username: env.CLICKHOUSE_USER,
        password: env.CLICKHOUSE_PASSWORD,
        url: env.CLICKHOUSE_URL,
        database: env.CLICKHOUSE_DATABASE,
        json: {
            stringify: serializeJsonWithBigInt,
        },
        clickhouse_settings: {
            date_time_input_format: 'best_effort',
            date_time_output_format: 'iso',
            output_format_json_named_tuples_as_objects: 1,
            output_format_json_quote_64bit_floats: 1,
            output_format_json_quote_64bit_integers: 1,
        },
    }),
    onStart: async ({ store }) => {
      const migrationsDir = path.join(process.cwd(), 'migrations')
      await store.executeFiles(migrationsDir)
    },
    onData: async ({ data, store }) => {
    {{#templates}}
    {{#tableNames}}
      await store.insert({
        table: '{{{.}}}',
        values: toSnakeKeysArray(data.{{{templateId}}}),
        format: 'JSONEachRow',
      });
    {{/tableNames}}
    {{/templates}}
    {{#customTemplates}}
    {{#schemaNames}}
      await store.insert({
        table: '{{{tableName}}}',
        values: toSnakeKeysArray(data.{{decoderId}}.{{{event}}}),
        format: 'JSONEachRow',
      });
    {{/schemaNames}}
    {{/customTemplates}}
    },
    onRollback: async ({ safeCursor, store }) => {
      await store.removeAllRows({
        tables: [
        {{#templates}}
        {{#tableNames}}
          '{{.}}',
        {{/tableNames}}
        {{/templates}}
        {{#customTemplates}}
        {{#schemaNames}}
          '{{tableName}}',
        {{/schemaNames}}
        {{/customTemplates}}
        ],
        where: 'block_number > {latest:UInt32}',
        params: { latest: safeCursor.number },
      });
    },
  })`

const envSchema = `
import { z } from 'zod'

const env = z.object({
  CLICKHOUSE_USER: z.string(),
  CLICKHOUSE_PASSWORD: z.string(),
  CLICKHOUSE_URL: z.string(),
  CLICKHOUSE_DATABASE: z.string(),
}).parse(process.env)
`

const envFileContent = `CLICKHOUSE_URL=http://localhost:${clickhouseDefaults.port}
CLICKHOUSE_DATABASE=${clickhouseDefaults.db}
CLICKHOUSE_USER=${clickhouseDefaults.user}
CLICKHOUSE_PASSWORD=${clickhouseDefaults.password}
    `

function renderCtx(config: Config<NetworkType>) {
  return {
    network: config.network,
    projectPath: '',
    networkType: config.networkType,
  }
}

function renderSinkCode(config: Config<NetworkType>): string {
  const ctx = renderCtx(config)

  const templates = config.templates
    .filter(({ template }) => template.id !== 'custom')
    .map(({ template, params }) => ({
      templateId: template.id,
      tableNames: extractCreateTableNames(template.render(params, ctx).clickhouseTable),
    }))

  const customTemplates = config.templates
    .filter(({ template }) => template.id === 'custom')
    .flatMap(({ params }) => {
      const contracts = (params as { contracts: Array<any> }).contracts
      const grouping = groupContractsForDecoders(contracts)
      return grouping.groups.map((group) => ({
        decoderId: group.decoderId,
        schemaNames: group.events.map((e) => ({
          event: e.name,
          tableName: chTableName(grouping, group.contracts[0].contractName, e.name),
        })),
      }))
    })

  return Mustache.render(sinkTemplate, {
    templates,
    customTemplates,
  })
}

function renderMigrationFiles(config: Config<NetworkType>): SinkFile[] {
  const ctx = renderCtx(config)
  return config.templates.map(({ template, params }) => ({
    path: `migrations/${template.id}-migration.sql`,
    content: template.render(params, ctx).clickhouseTable,
  }))
}

export function buildClickhouseSink(config: Config<NetworkType>): SinkArtifacts {
  return {
    sinkCode: renderSinkCode(config),
    envSchema,
    files: [{ path: '.env', content: envFileContent }, ...renderMigrationFiles(config)],
    postSteps: [],
  }
}
