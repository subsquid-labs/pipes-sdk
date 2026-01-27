import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toKebabCase } from '~/utils/string.js'

export class TemplateParser {
  static readonly TRANSFORMER_FILE = 'transformer.ts'
  static readonly PG_TABLE_FILE = 'pg-table.ts'
  static readonly CH_TABLE_FILE = 'clickhouse-table.sql'

  private readonly fullPath: string

  constructor(__dirname: string, templateId: string) {
    // Folders are named using kebab-case and template ids are camelCased
    this.fullPath = join(__dirname, toKebabCase(templateId))
  }

  readTrasnformer() {
    return this.readTemplateFile(TemplateParser.TRANSFORMER_FILE)
  }

  readClickhouseTable() {
    return this.readTemplateFile(TemplateParser.CH_TABLE_FILE)
  }

  readPgTable() {
    return this.readTemplateFile(TemplateParser.PG_TABLE_FILE)
  }

  readTemplateFile(file: string): string {
    return readFileSync(join(this.fullPath, file), 'utf-8').replace(/node_modules\//g, '')
  }
}
