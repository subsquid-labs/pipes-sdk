// Utility to parse and merge imports
import ts from 'typescript'

interface ParsedImport {
  defaultImport?: string
  namedImports: string[]
  namespaceImport?: string
  from: string
  typeOnly: boolean
  sideEffect?: boolean
}

export function splitImportsAndCode(content: string): {
  imports: ParsedImport[]
  code: string
} {
  // Legacy templates may contain `import { ... } as ns from '...'`, which is not valid
  // TypeScript. Normalize it to the equivalent namespace import before parsing.
  const normalized = content.replace(
    /import\s+\{[\s\S]*?\}\s+as\s+(\w+)\s+(from\s+['"][^'"]+['"];?)/g,
    'import * as $1 $2',
  )

  const sourceFile = ts.createSourceFile('module.ts', normalized, ts.ScriptTarget.Latest, true)

  const imports: ParsedImport[] = []
  const importRanges: Array<{ start: number; end: number }> = []

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue

    const parsed = parseImportDeclaration(statement, normalized)
    if (!parsed) continue

    imports.push(parsed)
    importRanges.push({ start: statement.getStart(sourceFile), end: statement.end })
  }

  // Splice import statements out of the source, keeping everything else as code
  let code = ''
  let cursor = 0
  for (const range of importRanges) {
    code += normalized.slice(cursor, range.start)
    cursor = range.end
  }
  code += normalized.slice(cursor)

  return { imports, code: code.trim() }
}

function parseImportDeclaration(node: ts.ImportDeclaration, content: string): ParsedImport | undefined {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return undefined

  const from = node.moduleSpecifier.text
  const clause = node.importClause

  if (!clause) {
    // Only treat as side-effect if it's not followed by a `from "..."` clause (a
    // malformed regular import the parser recovered from). Match the keyword directly
    // before a string literal so a following identifier like `fromage` doesn't misfire.
    if (/^from\s*['"]/.test(content.slice(node.end).trimStart())) return undefined

    return { namedImports: [], from, typeOnly: false, sideEffect: true }
  }

  const parsed: ParsedImport = {
    namedImports: [],
    from,
    typeOnly: clause.isTypeOnly,
  }

  if (clause.name) {
    parsed.defaultImport = clause.name.text
  }

  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      parsed.namespaceImport = clause.namedBindings.name.text
    } else {
      parsed.namedImports = clause.namedBindings.elements.map((element) => {
        const name = element.propertyName ? `${element.propertyName.text} as ${element.name.text}` : element.name.text

        return element.isTypeOnly ? `type ${name}` : name
      })
    }
  }

  return parsed
}

export function parseNamedImports(namedStr: string): string[] {
  return namedStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Handle `import { a as b }`
      const asMatch = s.match(/^(\w+)\s+as\s+(\w+)$/)
      return asMatch ? `${asMatch[1]} as ${asMatch[2]}` : s
    })
}

export function mergeImports(imports: ParsedImport[]): ParsedImport[] {
  const merged = new Map<string, ParsedImport>()
  const sideEffectImports = new Map<string, ParsedImport>()

  for (const imp of imports) {
    if (imp.sideEffect) {
      // Side-effect imports are standalone, just deduplicate by module path
      if (!sideEffectImports.has(imp.from)) {
        sideEffectImports.set(imp.from, { ...imp })
      }
      continue
    }

    // Keep namespace, type-only, and value imports as distinct entries so the
    // emitted statements stay syntactically valid and don't erase runtime identifiers.
    const key = `${imp.from}|${imp.typeOnly ? 'type' : 'value'}|${imp.namespaceImport ? 'ns' : 'std'}`
    const existing = merged.get(key)

    if (!existing) {
      const dedupNamedImports = Array.from(new Set(imp.namedImports))

      merged.set(key, { ...imp, namedImports: dedupNamedImports })
    } else {
      // Merge named imports
      const namedSet = new Set(existing.namedImports)
      imp.namedImports.forEach((n) => namedSet.add(n))
      existing.namedImports = Array.from(namedSet).sort()

      if (imp.defaultImport && !existing.defaultImport) {
        existing.defaultImport = imp.defaultImport
      }
      if (imp.namespaceImport && !existing.namespaceImport) {
        existing.namespaceImport = imp.namespaceImport
      }
    }
  }

  // Combine regular and side-effect imports, side-effects first
  return [...Array.from(sideEffectImports.values()), ...Array.from(merged.values())]
}

export function generateImportStatement(imp: ParsedImport): string {
  // Handle side-effect imports
  if (imp.sideEffect) {
    return `import "${imp.from}";`
  }

  const parts: string[] = []

  if (imp.typeOnly) {
    parts.push('import type')
  } else {
    parts.push('import')
  }

  const importParts: string[] = []

  if (imp.defaultImport) {
    importParts.push(imp.defaultImport)
  }

  if (imp.namedImports.length > 0) {
    importParts.push(`{ ${imp.namedImports.join(', ')} }`)
  }

  if (imp.namespaceImport) {
    importParts.push(`* as ${imp.namespaceImport}`)
  }

  if (importParts.length === 0) {
    return ''
  }

  return `${parts.join(' ')} ${importParts.join(', ')} from "${imp.from}";`
}
