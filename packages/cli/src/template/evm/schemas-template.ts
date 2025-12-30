import Mustache from 'mustache'
import { Config } from '~/types/config.js'
import { NetworkType } from '~/types/network.js'
import { TransformerTemplate } from '~/types/templates.js'
import { generateImportStatement, mergeImports, parseImports } from '~/utils/merge-imports.js'

export const schemasTemplate = `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

{{#schemas}}
{{{schema}}}

{{/schemas}}
export default {
{{#schemas}}
  {{{tableName}}},
{{/schemas}}
}
`

export function renderSchemasTemplate(config: Config<NetworkType>): string {
  const templateEntries = Object.entries(config.templates)
  const allImportStrings: string[] = []

  // Extract imports from each schema file
  for (const [, value] of templateEntries) {
    if (value.drizzleSchema) {
      const { imports } = parseImports(value.drizzleSchema)
      const importStatements = imports.map(generateImportStatement).filter((stmt) => stmt.length > 0)
      allImportStrings.push(...importStatements)
    }
  }

  // Merge all imports
  const combinedImports = allImportStrings.join('\n')
  const parsedImports = combinedImports ? parseImports(combinedImports).imports : []
  const mergedImports = mergeImports(parsedImports)
  const mergedImportStatements = mergedImports.map(generateImportStatement).filter((stmt) => stmt.length > 0)

  // Extract code (without imports) from each schema file
  const schemas = templateEntries
    .map(([, value]) => {
      if (!value.drizzleSchema) return

      const { code } = parseImports(value.drizzleSchema)

      return {
        schema: code,
        tableName: value.drizzleTableName,
      }
    })
    .filter((value): value is { schema: string; tableName: string } => !!value)

  return Mustache.render(schemasTemplate, {
    mergedImports: mergedImportStatements,
    schemas,
  })
}
