import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { ContractMetadata } from '~/services/sqd-abi.js'
import { NetworkType, PipeTemplate, Sink } from '~/types/init.js'
import { tableToSchemaName } from './schemas-template.js'

export const clickhouseSinkTemplate = `
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
      await store.insert({
        table: '{{{tableName}}}',
        values: toSnakeKeysArray(data.{{{templateId}}}),
        format: 'JSONEachRow',
      });
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
          '{{{tableName}}}',
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

export interface SinkTemplateParams {
  templates: PipeTemplate<NetworkType, any>[]
}

export function renderSinkTemplate(sink: Sink, params: SinkTemplateParams): string {
  const sinkTemplate = getSinkTemplate(sink)

  const templatesWithSchema = params.templates
    .filter((t) => t.templateId !== 'custom')
    .map((t) => ({
      ...t,
      schemaNames: [tableToSchemaName(t.templateId)],
    }))

  // TODO: add this to the TransformerTemplate
  const customTemplatesWithSchema = params.templates
    .filter((t): t is PipeTemplate<NetworkType, ContractMetadata[]> => t.templateId === 'custom')
    .map((t) => ({
      ...t,
      schemaNames: t.params.flatMap((c) =>
        c.contractEvents.map((e) => ({
          event: e.name,
          schemaName: tableToSchemaName(`${c.contractName}_${e.name}`),
          tableName: toSnakeCase(`${c.contractName}_${e.name}`),
        })),
      ),
    }))

  /**
   * TODO: we should merge these two arrays once we implement codegen for custom contracts
   * meaning tables, schemas, decoders, etc.
   */
  return Mustache.render(sinkTemplate, {
    ...params,
    templates: templatesWithSchema,
    customTemplates: customTemplatesWithSchema.filter((t) => t.templateId === 'custom'),
  })
}

export function getSinkTemplate(sink: Sink): string {
  if (sink === 'clickhouse') return clickhouseSinkTemplate
  else if (sink === 'postgresql') return postgresSinkTemplate
  else if (sink === 'memory') throw new Error('Memory not implemented')
  else throw new Error(`Sink type ${sink} does not exist or its template not implemented`)
}
