import Mustache from 'mustache'
import { Sink } from '~/types/sink.js'
import { TransformerTemplate } from '~/types/templates.js'
import { splitImportsAndCode } from '~/utils/merge-imports.js'
import { tableToSchemaName } from './schemas-template.js'

export const clickhouseSinkTemplate = `
import { clickhouseTarget } from '@subsquid/pipes/targets/clickhouse'
import { createClient } from '@clickhouse/client'
import { serializeJsonWithBigInt, toSnakeKeysArray } from './utils/index.js'

clickhouseTarget({
    client: createClient({
        username: process.env.CLICKHOUSE_USER ?? (() => { throw new Error('CLICKHOUSE_USER is not set')})(),
        password: process.env.CLICKHOUSE_PASSWORD ?? (() => { throw new Error('CLICKHOUSE_PASSWORD is not set')})(),
        url: process.env.CLICKHOUSE_URL ?? (() => { throw new Error('CLICKHOUSE_URL is not set')})(),
        json: {
            stringify: serializeJsonWithBigInt,
        },
    }),
    onStart: async ({ store }) => {
      await store.executeFiles('./src/migrations')
    },
    onData: async ({ data, store }) => {
{{#templates}}
      await store.insert({
        table: '{{{tableName}}}',
        values: toSnakeKeysArray(data.{{{name}}}),
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
    db: drizzle(
      process.env.DB_CONNECTION_STR ??
        (() => { throw new Error('DB_CONNECTION_STR env missing') })(),
    ),
    tables: [{{#templates}}{{{schemaName}}}{{^last}}, {{/last}}{{/templates}}{{#customTemplates}}{{{schemaName}}}{{^last}}, {{/last}}{{/customTemplates}}],
    onData: async ({ tx, data }) => {
{{#templates}}
      for (const values of chunk(data.{{{name}}})) {
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
  templates: TransformerTemplate[]
}

export function renderSinkTemplate__(sink: Sink, params: SinkTemplateParams) {
  const sinkTemplate = getSinkTemplate(sink)
  const { code } = splitImportsAndCode(sinkTemplate)
  return Mustache.render(code, params)
}

export function getSinkTemplate(sink: Sink): string {
  if (sink === 'clickhouse') return clickhouseSinkTemplate
  else if (sink === 'postgresql') return postgresSinkTemplate
  else if (sink === 'memory') throw new Error('Memory not implemented')
  else throw new Error(`Sink type ${sink} does not exist or its template not implemented`)
}

export function renderSinkTemplate(sink: Sink, params: SinkTemplateParams): string {
  const sinkTemplate = getSinkTemplate(sink)
  const transformerTemplatesWithSchema = params.templates
      .map((t) => ({
        ...t,
        schemaName: tableToSchemaName(t.tableName),
      }))

  /**
   * TODO: we should merge these two arrays once we implement codegen for custom contracts
   * meaning tables, schemas, decoders, etc.
   */
  return Mustache.render(sinkTemplate, {
    ...params,
    templates: transformerTemplatesWithSchema.filter((t) => t.name !== 'custom'),
    customTemplates: transformerTemplatesWithSchema.filter((t) => t.name === 'custom'),
  })
}
