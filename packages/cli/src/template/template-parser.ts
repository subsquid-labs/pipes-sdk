import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateImportStatement, parseImports } from '~/utils/merge-imports.js'

export class TemplateParser {
  constructor(private readonly __dirname: string) {}

  readTemplateFile(relativePath: string): string {
    return readFileSync(join(this.__dirname, relativePath), 'utf-8')
  }

  extractVariableName(code: string): string {
    const match = code.match(/^(?:export\s+)?const\s+(\w+)\s*=/m)
    return match ? match[1] : 'unknown'
  }

  parseTemplateFile(relativePath: string): {
    imports: string[]
    code: string
    variableName: string
  } {
    const content = this.readTemplateFile(relativePath)
    const { imports, code } = parseImports(content)
    // Clean node_modules/ from import paths
    imports.forEach((imp) => {
      imp.from = imp.from.replace(/^node_modules\//, '')
    })
    const variableName = this.extractVariableName(code)
    return {
      imports: imports.map(generateImportStatement).filter((stmt) => stmt.length > 0),
      code,
      variableName,
    }
  }
}
