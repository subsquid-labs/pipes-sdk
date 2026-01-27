import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'

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

export const tableToSchemaName = (tableName: string) => `${toCamelCase(tableName)}Table`

export function renderSchemasTemplate(renderedSchemas: string[]): string {
  const schemaImports = renderedSchemas.map((schema) => splitImportsAndCode(schema).imports).flat()
  const schemaCode = renderedSchemas.map((schema) => splitImportsAndCode(schema).code)
  const mergedImports = mergeImports(schemaImports)
  const mergedImportStatements = mergedImports.map(generateImportStatement).filter((stmt) => stmt.length > 0)

  return Mustache.render(schemasTemplate, {
    mergedImports: mergedImportStatements,
    schemas: schemaCode.map((s) => ({
      schemaCode: s,
      schemaNames: extractExportConstNames(s),
    })),
  })
}

const EXPORT_CONST_NAME_REGEX = /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\b/gm
function extractExportConstNames(code: string): string[] {
  const names: string[] = []
  for (const m of code.matchAll(EXPORT_CONST_NAME_REGEX)) names.push(m[1])
  return [...new Set(names)]
}
