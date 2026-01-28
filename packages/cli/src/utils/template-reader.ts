import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toKebabCase } from '~/utils/string.js'

export class TemplateReader {
  static readonly TEMPLATE_DIR = 'templates'
  static readonly TRANSFORMER_FILE = `${TemplateReader.TEMPLATE_DIR}/transformer.ts`
  static readonly PG_TABLE_FILE = `${TemplateReader.TEMPLATE_DIR}/pg-table.ts`
  static readonly CH_TABLE_FILE = `${TemplateReader.TEMPLATE_DIR}/clickhouse-table.sql`

  private readonly fullPath: string

  constructor(__dirname: string, templateId: string) {
    // Folders are named using kebab-case and template ids are camelCased
    this.fullPath = join(__dirname, toKebabCase(templateId))
  }

  readTransformer() {
    return this.readTemplateFile(TemplateReader.TRANSFORMER_FILE)
  }

  readClickhouseTable() {
    return this.readTemplateFile(TemplateReader.CH_TABLE_FILE)
  }

  readPgTable() {
    return this.readTemplateFile(TemplateReader.PG_TABLE_FILE)
  }

  readTemplateFile(file: string): string {
    return readFileSync(join(this.fullPath, file), 'utf-8').replace(/node_modules\//g, '')
  }
}
