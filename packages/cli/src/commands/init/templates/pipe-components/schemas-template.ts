import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { Config, NetworkType, WithContractMetadata } from '~/types/init.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'
import { eventTableName, renderCustomSchema } from '../pipe-templates/evm/custom/pg-table.js'

export const schemasTemplate = `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

{{#schemas}}
{{{schemaCode}}}

{{/schemas}}
export default {
{{#schemas}}
  {{#schemaNames}}
  {{.}},
  {{/schemaNames}}
{{/schemas}}
}
`

interface SchemaTemplateParams {
  schemaCode: string
  schemaNames: string[]
  fullSchema: string
}

export const tableToSchemaName = (tableName: string) => `${toCamelCase(tableName)}Table`

export function renderSchemasTemplate(config: WithContractMetadata<Config<NetworkType>>): string {
  // Extract code (without imports) from each schema file
  const customTemplateSchemas = config.templates
    .filter((t) => t.templateId === 'custom')
    .map(() => {
      const code = renderCustomSchema(config)

      return {
        fullSchema: code,
        schemaCode: splitImportsAndCode(code).code,
        schemaNames: config.contracts.flatMap((c) =>
          c.contractEvents.map((e) => tableToSchemaName(eventTableName(c, e))),
        ),
      }
    })
    .filter((t): t is SchemaTemplateParams => !!t)

  const templateSchemas = config.templates
    .filter((t) => t.templateId !== 'custom')
    .map((template) => {
      if (!template.drizzleSchema) return

      const { code } = splitImportsAndCode(template.drizzleSchema)

      return {
        fullSchema: template.drizzleSchema,
        schemaCode: code,
        schemaNames: [tableToSchemaName(template.tableName)],
      }
    })
    .filter((t): t is SchemaTemplateParams => !!t)

  const templateImports = [...templateSchemas, ...customTemplateSchemas].flatMap(
    (template) => splitImportsAndCode(template.fullSchema).imports,
  )

  const mergedImports = mergeImports(templateImports)
  const mergedImportStatements = mergedImports.map(generateImportStatement).filter((stmt) => stmt.length > 0)

  return Mustache.render(schemasTemplate, {
    mergedImports: mergedImportStatements,
    schemas: [...templateSchemas, ...customTemplateSchemas],
  })
}
