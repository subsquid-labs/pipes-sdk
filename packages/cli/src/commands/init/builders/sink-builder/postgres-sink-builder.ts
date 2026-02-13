import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { NetworkType, PipeTemplateMeta } from '~/types/init.js'

import { postgresDefaults } from '../../templates/config-files/dynamic/docker-compose.js'
import { drizzleConfigTemplate } from '../../templates/config-files/static/drizzle-config.js'
import { groupContractsForDecoders } from '../../templates/pipes/evm/custom/decoder-grouping.js'
import { tableName as pgTableName } from '../../templates/pipes/evm/custom/templates/pg-table.js'
import { CustomTemplateParamsSchema } from '../../templates/pipes/evm/custom/template.config.js'
import { renderSchemasTemplate, tableToSchemaName } from '../schema-builder/index.js'
import { BaseSinkBuilder } from './base-sink-builder.js'

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

export class PostgresSinkBuilder extends BaseSinkBuilder {
  render() {
    const templates = this.config.templates
      .filter((t) => t.templateId !== 'custom')
      .map((t) => ({
        schemas: this.extractExportConstNames(t.renderPostgresSchemas()),
        templateId: t.templateId,
      }))

    const customTemplates = this.config.templates
      .filter((t): t is PipeTemplateMeta<NetworkType, typeof CustomTemplateParamsSchema> => t.templateId === 'custom')
      .flatMap((t) => {
        const grouping = groupContractsForDecoders(t.getParams().contracts)
        return grouping.groups.map((group) => ({
          decoderId: group.decoderId,
          schemas: group.events.map((e) => ({
            event: e.name,
            schemaName: tableToSchemaName(
              pgTableName(grouping, group.contracts[0].contractName, e.name),
            ),
          })),
        }))
      })

    return Mustache.render(sinkTemplate, {
      templates,
      customTemplates,
    })
  }

  async createMigrations(): Promise<void> {
    const schemas = this.config.templates.map((t) => t.renderPostgresSchemas())
    const renderedSchemas = renderSchemasTemplate(schemas)
    this.projectWriter.createFile(`src/schemas.ts`, renderedSchemas)
    this.projectWriter.createFile('drizzle.config.ts', drizzleConfigTemplate)
    await this.generateDatabaseMigrations()
  }

  private async generateDatabaseMigrations(): Promise<void> {
    await this.projectWriter.executeCommand(`${this.config.packageManager} run db:generate`)
  }

  async createEnvFile(): Promise<void> {
    this.projectWriter.createFile(
      '.env',
      `DB_CONNECTION_STR=postgresql://${postgresDefaults.user}:${postgresDefaults.password}@localhost:${postgresDefaults.port}/${postgresDefaults.db}`,
    )
  }

  getEnvSchema(): string {
    return `
import { z } from 'zod'

const env = z.object({
  DB_CONNECTION_STR: z.string(),
}).parse(process.env)
`
  }

  protected extractExportConstNames(code: string): string[] {
    const EXPORT_CONST_NAME_REGEX = /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\b/gm
    const names: string[] = []
    for (const m of code.matchAll(EXPORT_CONST_NAME_REGEX)) names.push(m[1])
    return [...new Set(names)]
  }
}
