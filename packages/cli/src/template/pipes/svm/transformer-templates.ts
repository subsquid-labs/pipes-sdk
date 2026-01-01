import { SolanaTemplateIds } from '~/config/templates.js'
import { getDirname } from '~/template/get-dirname.js'
import { TemplateParser } from '~/template/template-parser.js'
import { TransformerTemplate } from '~/types/templates.js'

const __dirname = getDirname('svm')
const parser = new TemplateParser(__dirname)

export const svmTemplates: Record<SolanaTemplateIds, TransformerTemplate> = {
  custom: (() => {
    const parsed = parser.parseTemplateFile('custom-contract/transformer.ts')
    const drizzleSchema = parser.readTemplateFile('custom-contract/pg-table.ts')
    return {
      compositeKey: 'custom',
      transformer: '',
      imports: parsed.imports,
      variableName: parsed.variableName,
      tableName: 'custom_contract',
      clickhouseTableTemplate: parser.readTemplateFile('custom-contract/clickhouse-table.sql'),
      drizzleSchema,
      drizzleTableName: parser.extractVariableName(drizzleSchema),
    }
  })(),
  'token-balances': (() => {
    const parsed = parser.parseTemplateFile('token-balances/transformer.ts')
    const drizzleSchema = parser.readTemplateFile('token-balances/pg-table.ts')
    return {
      compositeKey: 'balances',
      transformer: parsed.code,
      imports: parsed.imports,
      variableName: parsed.variableName,
      tableName: 'token_balances',
      clickhouseTableTemplate: parser.readTemplateFile('token-balances/clickhouse-table.sql'),
      drizzleSchema,
      drizzleTableName: parser.extractVariableName(drizzleSchema),
    }
  })(),
}
