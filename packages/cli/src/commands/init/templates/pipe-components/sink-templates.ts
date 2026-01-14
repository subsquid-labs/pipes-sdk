import Mustache from 'mustache'
import { NetworkType, Sink, TransformerTemplate } from '~/types/init.js'
import { tableToSchemaName } from './schemas-template.js'

export const clickhouseSinkTemplate = `
import { clickhouseTarget } from '@subsquid/pipes/targets/clickhouse'
import { createClient } from '@clickhouse/client'
import { serializeJsonWithBigInt, toSnakeKeysArray } from './utils/index.js'

clickhouseTarget({
    client: createClient({
        username: env.CLICKHOUSE_USER,
        password: env.CLICKHOUSE_PASSWORD,
        url: env.CLICKHOUSE_URL,
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
      await store.executeFiles('./src/migrations')
    },
    onData: async ({ data, store }) => {
{{#templates}}
      await store.insert({
        table: '{{{tableName}}}',
        values: toSnakeKeysArray(data.{{{templateId}}}),
        format: 'JSONEachRow',
      });
{{/templates}}
{{#hasCustomContracts}}
      /**
       * Once the data is transformed, you can insert it into the database.
       * 
       * await store.insert({
       *   table: 'custom_contract',
       *   values: toSnakeKeysArray(data.custom),
       *   format: 'JSONEachRow',
       * })
       */
{{/hasCustomContracts}}
    },
    onRollback: async ({ safeCursor, store }) => {
      await store.removeAllRows({
        tables: [
{{#templates}}
          '{{{tableName}}}',
{{/templates}}
        ],
        where: 'block_number > {latest:UInt32}',
        params: { latest: safeCursor.number },
      });
    },
  })`

export const postgresSinkTemplate = `
import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres',
import { drizzle } from 'drizzle-orm/node-postgres',
import {
  {{#templates}}
  {{{schemaName}}},
  {{/templates}}
  {{#customTemplates}}
  {{{schemaName}}},
  {{/customTemplates}}
} from './schemas.js'

drizzleTarget({
    db: drizzle(env.DB_CONNECTION_STR),
    tables: [
      {{#templates}}
      {{{schemaName}}},
      {{/templates}}
      {{#customTemplates}}
      {{{schemaName}}},
      {{/customTemplates}}
    ],
    onData: async ({ tx, data }) => {
{{#templates}}
      for (const values of chunk(data.{{{templateId}}})) {
        await tx.insert({{{schemaName}}}).values(values)
      }
{{/templates}}
{{#hasCustomContracts}}
      /**
       * Once the data is transformed, you can insert it into the database.
       *  
       * for (const values of chunk(data.custom.MyContractEvent)) {
       *   await tx.insert(customContract).values(values)
       * }
       */
{{/hasCustomContracts}}
    },
  })`

interface SinkTemplateParams {
  hasCustomContracts: boolean
  templates: TransformerTemplate<NetworkType>[]
}

export function getSinkTemplate(sink: Sink): string {
  if (sink === 'clickhouse') return clickhouseSinkTemplate
  else if (sink === 'postgresql') return postgresSinkTemplate
  else if (sink === 'memory') throw new Error('Memory not implemented')
  else throw new Error(`Sink type ${sink} does not exist or its template not implemented`)
}

export function renderSinkTemplate(sink: Sink, params: SinkTemplateParams): string {
  const sinkTemplate = getSinkTemplate(sink)
  const transformerTemplatesWithSchema = params.templates.map((t) => ({
    ...t,
    schemaName: tableToSchemaName(t.tableName),
  }))

  /**
   * TODO: we should merge these two arrays once we implement codegen for custom contracts
   * meaning tables, schemas, decoders, etc.
   */
  return Mustache.render(sinkTemplate, {
    ...params,
    templates: transformerTemplatesWithSchema.filter((t) => t.templateId !== 'custom'),
    customTemplates: transformerTemplatesWithSchema.filter((t) => t.templateId === 'custom'),
  })
}
