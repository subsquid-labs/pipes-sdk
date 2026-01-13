import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EvmTemplateIds, SvmTemplateIds } from '~/config/templates.js'

export class TemplateParser {
  constructor(private readonly __dirname: string) {}

  readTemplateFile(relativePath: string): string {
    return readFileSync(join(this.__dirname, relativePath), 'utf-8').replace(/node_modules\//g, '')
  }

  readTemplateFiles(templateId: EvmTemplateIds | SvmTemplateIds) {
    const code = this.readTemplateFile(`${templateId}/transformer.ts`)
    const drizzleSchema = this.readTemplateFile(`${templateId}/pg-table.ts`)
    const clickhouseTableTemplate = this.readTemplateFile(`${templateId}/clickhouse-table.sql`)
    return {
      code,
      clickhouseTableTemplate,
      drizzleSchema,
    }
  }
}
