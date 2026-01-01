import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SolanaTemplateIds } from '~/config/templates.js'
import { TransformerTemplate } from '~/types/templates.js'
import { TemplateParser } from '~/template/template-parser.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const parser = new TemplateParser(__dirname)

export const svmTemplates: Record<SolanaTemplateIds, TransformerTemplate> = {
  custom: {
    compositeKey: 'custom',
    transformer: `solanaInstructionDecoder({
        range: { from: "latest" },
        programId: [],
        instructions: {},
    })`,
    tableName: 'customContract',
    drizzleTableName: 'customContract',
  },
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
