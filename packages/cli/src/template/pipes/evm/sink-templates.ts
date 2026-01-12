import Mustache from 'mustache'
import { Sink } from '~/types/sink.js'
import { TransformerTemplate } from '~/types/templates.js'
import { splitImportsAndCode } from '~/utils/merge-imports.js'

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
{{#hasTable}}
{{^excludeFromInsert}}
      await store.insert({
        table: '{{{tableName}}}',
        values: toSnakeKeysArray(data.{{{variableName}}}),
        format: 'JSONEachRow',
      });
{{/excludeFromInsert}}
{{/hasTable}}
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
{{#hasTable}}
          '{{{tableName}}}',
{{/hasTable}}
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

drizzleTarget({
    db: drizzle(
      process.env.DB_CONNECTION_STR ??
        (() => { throw new Error('DB_CONNECTION_STR env missing') })(),
    ),
    tables: [{{#templates}}{{{drizzleTableName}}}{{^last}}, {{/last}}{{/templates}}],
    onData: async ({ tx, data }) => {
{{#templates}}
{{#hasTable}}
{{^excludeFromInsert}}
      for (const values of chunk(data.{{{variableName}}})) {
        await tx.insert({{{drizzleTableName}}}).values(values)
      }
{{/excludeFromInsert}}
{{/hasTable}}
{{/templates}}
{{#hasCustomContracts}}
      /**
       * Once the data is transformed, you can insert it into the database.
       *  
       * for (const values of chunk(data.custom)) {
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

export function renderSinkTemplate(sink: Sink, params: SinkTemplateParams) {
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
