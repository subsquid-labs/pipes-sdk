import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { Config, NetworkType } from '~/types/init.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'

export const schemasTemplate = `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

{{#schemas}}
{{{schema}}}

{{/schemas}}
export default {
{{#schemas}}
  {{{schemaName}}},
{{/schemas}}
}
`

export const tableToSchemaName = (tableName: string) => `${toCamelCase(tableName)}Table`

export function renderSchemasTemplate(config: Config<NetworkType>): string {
  // Extract imports from each schema file
  const allImportStrings = config.templates.flatMap((template) => {
    if (!template.drizzleSchema) return []
    const { imports } = splitImportsAndCode(template.drizzleSchema)
    return imports.map(generateImportStatement).filter((stmt) => stmt.length > 0)
  })

  // Merge all imports
  const combinedImports = allImportStrings.join('\n')
  const parsedImports = combinedImports ? splitImportsAndCode(combinedImports).imports : []
  const mergedImports = mergeImports(parsedImports)
  const mergedImportStatements = mergedImports.map(generateImportStatement).filter((stmt) => stmt.length > 0)

  // Extract code (without imports) from each schema file
  const schemas = config.templates
    .map((template) => {
      if (!template.drizzleSchema) return

      const { code } = splitImportsAndCode(template.drizzleSchema)

      return {
        schema: code,
        schemaName: tableToSchemaName(template.tableName),
      }
    })
    .filter((t): t is { schema: string; schemaName: string } => !!t)

  return Mustache.render(schemasTemplate, {
    mergedImports: mergedImportStatements,
    schemas,
  })
}
