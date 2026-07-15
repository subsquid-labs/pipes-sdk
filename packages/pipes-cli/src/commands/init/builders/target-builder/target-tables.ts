import type { RenderedTemplate } from '../render-templates.js'
import { tableToSchemaName } from '../schema-builder/index.js'

/**
 * The flat insert surface across every configured template, in template order.
 * `dataPath` is the expression under `data.` that yields the rows for `table`.
 */
export function insertEntries(rendered: RenderedTemplate[]) {
  return rendered.flatMap(({ artifacts }) =>
    artifacts.tables.map(({ decoderId, table, event }) => ({
      table,
      schemaName: tableToSchemaName(table),
      dataPath: event ? `${decoderId}.${event}` : decoderId,
    })),
  )
}

export function uniqueTables(rendered: RenderedTemplate[]): string[] {
  return [...new Set(rendered.flatMap(({ artifacts }) => artifacts.tables.map((t) => t.table)))]
}

export function uniqueSchemaNames(rendered: RenderedTemplate[]): string[] {
  return [...new Set(rendered.flatMap(({ artifacts }) => artifacts.tables.map((t) => tableToSchemaName(t.table))))]
}
