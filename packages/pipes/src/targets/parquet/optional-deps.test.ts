import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** The two optional peer deps this target subpath must stay importable without. */
const OPTIONAL_DEPS = ['@dsnp/parquetjs', '@duckdb/node-api']

type Violation = { line: number; statement: string }

/**
 * Scans TypeScript source text for static value-imports of `OPTIONAL_DEPS`. Allowed: `import
 * type {...} from 'X'`, `import { type A, type B } from 'X'` (every named binding type-
 * qualified), and dynamic `import('X')` calls — the two engines' sanctioned lazy load points.
 * Everything else that reaches an optional dep via `import ... from 'X'`, `export ... from 'X'`,
 * or a bare `import 'X'` is a violation: it would crash `import '@subsquid/pipes/targets/parquet'`
 * for consumers who never installed the optional peer.
 *
 * A pure function over source text (not file paths), so the detector itself can be unit-tested
 * against a synthetic string below instead of only ever running against the real tree.
 */
function findOptionalDepViolations(source: string): Violation[] {
  // Comments can't hide a real import, nor can a documented example fake one: block comments are
  // blanked out (newlines kept, so later line numbers stay accurate) and line comments dropped.
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  const lines = withoutBlocks.replace(/\/\/.*/g, '').split('\n')
  const violations: Violation[] = []

  for (let i = 0; i < lines.length; i++) {
    // Only column-0 `import`/re-export `export` declarations qualify. This naturally excludes
    // the lazy loaders' `import(...)` calls (indented inside function bodies) and non-re-export
    // `export`s (`export function`, `export const`, `export type X = ...`, ...).
    if (!/^import\b/.test(lines[i]) && !/^export\s+(type\s+)?[{*]/.test(lines[i])) continue

    // A named-import list can wrap across lines; keep absorbing lines until braces balance.
    let statement = lines[i]
    let depth = braceDelta(statement)
    for (let j = i + 1; depth > 0 && j < lines.length; j++) {
      statement += `\n${lines[j]}`
      depth += braceDelta(lines[j])
    }

    for (const dep of OPTIONAL_DEPS) {
      const referencesDep = statement.includes(`'${dep}'`) || statement.includes(`"${dep}"`)

      if (referencesDep && !isTypeOnlyImport(statement)) {
        violations.push({ line: i + 1, statement: statement.trim() })
      }
    }
  }

  return violations
}

function braceDelta(line: string): number {
  return (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)
}

/** True for `import type {...} from 'X'` or `import { type A, type B, ... } from 'X'`. */
function isTypeOnlyImport(statement: string): boolean {
  if (!/^import\b/.test(statement)) return false // `export ... from 'X'` is always a violation

  const clause = statement.replace(/^import\s*/, '')
  if (/^type\b/.test(clause)) return true

  const named = clause.match(/^\{([\s\S]*)\}\s*from/)
  if (!named) return false // default / namespace / bare import — always a value import

  const bindings = named[1]
    .split(',')
    .map((binding) => binding.trim())
    .filter(Boolean)

  return bindings.length > 0 && bindings.every((binding) => /^type\s+/.test(binding))
}

describe('optional dependency isolation', () => {
  it('has zero static value-imports of the optional peer deps in the target sources', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    const files = readdirSync(dir).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))

    const failures = files.flatMap((file) =>
      findOptionalDepViolations(readFileSync(path.join(dir, file), 'utf8')).map(
        (v) => `${file}:${v.line}: ${v.statement}`,
      ),
    )

    expect(
      failures,
      `@dsnp/parquetjs and @duckdb/node-api are optional peer deps of the parquet target — ` +
        `reference either only via 'import type' or the module's lazy loader ` +
        `(parquetjs-engine.ts / duckdb-engine.ts), never a static value import:\n${failures.join('\n')}`,
    ).toEqual([])
  })

  it('sanity: the scan detects a violation in a synthetic bad source', () => {
    const bad = "import { ParquetSchema } from '@dsnp/parquetjs'\n"

    expect(findOptionalDepViolations(bad)).toEqual([{ line: 1, statement: bad.trim() }])
  })
})
