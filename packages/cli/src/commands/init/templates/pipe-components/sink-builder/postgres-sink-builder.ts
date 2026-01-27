import Mustache from 'mustache'
import { ContractMetadata } from '~/services/sqd-abi.js'
import { NetworkType, PipeTemplate } from '~/types/init.js'
import { renderSchemasTemplate, tableToSchemaName } from '../schemas-template.js'
import { BaseSinkBuilder } from './base-sink-builder.js'
import { postgresDefaults } from '../../project-files/dynamic/docker-compose.js'
import { drizzleConfigTemplate } from '../../project-files/static/drizzle-config.js'

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
      for (const values of chunk(data.{{templateId}}.{{event}})) {
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
        schemas: this.extractExportConstNames(t.renderFns.postgresSchemas()),
        templateId: t.templateId,
      }))

    const customTemplates = this.config.templates
      .filter((t): t is PipeTemplate<NetworkType, ContractMetadata[]> => t.templateId === 'custom')
      .map((t) => ({
        templateId: t.templateId,
        schemas: t.params.flatMap((c) =>
          c.contractEvents.map((e) => ({
            event: e.name,
            schemaName: tableToSchemaName(`${c.contractName}_${e.name}`),
          })),
        ),
      }))

    return Mustache.render(sinkTemplate, {
      templates,
      customTemplates,
    })
  }

  async createMigrations(): Promise<void> {
    this.config.templates.forEach((t) => {
      const schemas = renderSchemasTemplate(this.config)
      this.projectWriter.createFile(`src/schemas.ts`, schemas)
    })
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
function execAsync(arg0: string, arg1: { cwd: any }) {
  throw new Error('Function not implemented.')
}

