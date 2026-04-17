import Mustache from 'mustache'

import type { Config, NetworkType } from '~/types/init.js'

import { postgresDefaults } from '../../templates/config-files/dynamic/docker-compose.js'
import { drizzleConfigTemplate } from '../../templates/config-files/static/drizzle-config.js'
import { groupContractsForDecoders } from '../../templates/pipes/evm/custom/decoder-grouping.js'
import { renderSchemasTemplate, tableToSchemaName } from '../schema-builder/index.js'
import type { SinkArtifacts } from './sink-artifacts.js'
import { extractExportConstNames, tableName as pgTableName } from './shared.js'

const sinkTemplate = `
import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres',
import { drizzle } from 'drizzle-orm/node-postgres',
import {
  {{#templates}}
  {{#schemas}}
  {{.}},
  {{/schemas}}
  {{/templates}}
  {{#customTemplates}}
  {{#schemas}}
  {{schemaName}},
  {{/schemas}}
  {{/customTemplates}}
} from './schemas.js'

drizzleTarget({
    db: drizzle(env.DB_CONNECTION_STR),
    tables: [
      {{#templates}}
      {{#schemas}}
      {{.}},
      {{/schemas}}
      {{/templates}}
      {{#customTemplates}}
      {{#schemas}}
      {{schemaName}},
      {{/schemas}}
      {{/customTemplates}}
    ],
    onData: async ({ tx, data }) => {
    {{#templates}}
      for (const values of chunk(data.{{{templateId}}})) {
        {{#schemas}}
        await tx.insert({{.}}).values(values)
        {{/schemas}}
      }
    {{/templates}}
    {{#customTemplates}}
      {{#schemas}}
      for (const values of chunk(data.{{decoderId}}.{{event}})) {
        await tx.insert({{schemaName}}).values(values)
      }
      {{/schemas}}
    {{/customTemplates}}
    },
  })`

const envSchema = `
import { z } from 'zod'

const env = z.object({
  DB_CONNECTION_STR: z.string(),
}).parse(process.env)
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
      schemas: extractExportConstNames(template.render(params, ctx).postgresSchema),
      templateId: template.id,
    }))

  const customTemplates = config.templates
    .filter(({ template }) => template.id === 'custom')
    .flatMap(({ params }) => {
      const contracts = (params as { contracts: Array<any> }).contracts
      const grouping = groupContractsForDecoders(contracts)
      return grouping.groups.map((group) => ({
        decoderId: group.decoderId,
        schemas: group.events.map((e) => ({
          event: e.name,
          schemaName: tableToSchemaName(pgTableName(grouping, group.contracts[0].contractName, e, group.events)),
        })),
      }))
    })

  return Mustache.render(sinkTemplate, {
    templates,
    customTemplates,
  })
}

function renderEnvFile(): string {
  return `DB_CONNECTION_STR=postgresql://${postgresDefaults.user}:${postgresDefaults.password}@localhost:${postgresDefaults.port}/${postgresDefaults.db}`
}

function renderSchemasFile(config: Config<NetworkType>): string {
  const ctx = renderCtx(config)
  const schemas = config.templates.map(({ template, params }) => template.render(params, ctx).postgresSchema)
  return renderSchemasTemplate(schemas)
}

export function buildPostgresSink(config: Config<NetworkType>): SinkArtifacts {
  return {
    sinkCode: renderSinkCode(config),
    envSchema,
    files: [
      { path: '.env', content: renderEnvFile() },
      { path: 'src/schemas.ts', content: renderSchemasFile(config) },
      { path: 'drizzle.config.ts', content: drizzleConfigTemplate },
    ],
    postSteps: [{ kind: 'exec', command: `${config.packageManager} run db:generate` }],
  }
}
