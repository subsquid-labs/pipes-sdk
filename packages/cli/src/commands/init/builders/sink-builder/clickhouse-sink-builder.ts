import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { NetworkType, PipeTemplateMeta } from '~/types/init.js'

import { clickhouseDefaults } from '../../templates/config-files/dynamic/docker-compose.js'
import { CustomTemplateParamsSchema } from '../../templates/pipes/evm/custom/template.config.js'
import { BaseSinkBuilder } from './base-sink-builder.js'

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
        values: toSnakeKeysArray(data.{{templateId}}.{{{event}}}),
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

export class ClickhouseSinkBuilder extends BaseSinkBuilder {
  render() {
    const templates = this.config.templates
      .filter((t) => t.templateId !== 'custom')
      .map((t) => ({
        ...t,
        tableNames: this.extactTableNames(t.renderClickhouseTables()),
      }))

    const customTemplates = this.config.templates
      .filter((t): t is PipeTemplateMeta<NetworkType, typeof CustomTemplateParamsSchema> => t.templateId === 'custom')
      .map((t) => ({
        templateId: t.templateId,
        schemaNames: t.getParams().contracts.flatMap((c) =>
          c.contractEvents.map((e) => ({
            event: e.name,
            tableName: toSnakeCase(`${c.contractName}_${e.name}`),
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
      this.projectWriter.createFile(`migrations/${t.templateId}-migration.sql`, t.renderClickhouseTables())
    })
  }

  async createEnvFile(): Promise<void> {
    this.projectWriter.createFile(
      '.env',
      `CLICKHOUSE_URL=http://localhost:${clickhouseDefaults.port}
CLICKHOUSE_DATABASE=${clickhouseDefaults.db}
CLICKHOUSE_USER=${clickhouseDefaults.user}
CLICKHOUSE_PASSWORD=${clickhouseDefaults.password}
    `,
    )
  }

  getEnvSchema(): string {
    return `
import { z } from 'zod'

const env = z.object({
  CLICKHOUSE_USER: z.string(),
  CLICKHOUSE_PASSWORD: z.string(),
  CLICKHOUSE_URL: z.string(),
  CLICKHOUSE_DATABASE: z.string(),
}).parse(process.env)
`
  }

  private extactTableNames(code: string): string[] {
    const CREATE_TABLE_IF_NOT_EXISTS_NAME_REGEX =
      /^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gim
    const names: string[] = []
    for (const m of code.trim().matchAll(CREATE_TABLE_IF_NOT_EXISTS_NAME_REGEX)) {
      names.push(m[1])
    }
    return [...new Set(names)]
  }
}
