import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type Violation = { line: number; statement: string }

/**
 * Scans core (non-`duckdb/`) TypeScript source text for any knowledge of the duckdb entry:
 * a reference to `@duckdb/node-api` (any import/export form — type-only included) or an
 * import from `./duckdb/` / `../duckdb/`. The dependency direction is strictly one-way — `duckdb/` imports
 * core, never the reverse — which is what keeps `@subsquid/pipes/targets/parquet` importable
 * without the optional `@duckdb/node-api` peer installed.
 *
 * A pure function over source text (not file paths), so the detector itself can be
 * unit-tested against synthetic strings below instead of only ever running against the
 * real tree.
 */
function findDuckdbReferences(source: string): Violation[] {
  // Comments can't hide a real reference, nor can a documented example fake one: block
  // comments are blanked out (newlines kept, so later line numbers stay accurate) and line
  // comments dropped.
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
  const lines = withoutBlocks.replace(/\/\/.*/g, '').split('\n')
  const violations: Violation[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const referencesDuckdb = line.includes('@duckdb/node-api') || /['"]\.\.?\/duckdb\//.test(line)

    if (referencesDuckdb) violations.push({ line: i + 1, statement: line.trim() })
  }

  return violations
}

describe('core isolation from the duckdb entry', () => {
  it('no non-test core source references @duckdb/node-api or imports from ./duckdb/', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url))
    // Core is the top-level entry plus the parquetjs/ engine folder — everything except duckdb/.
    const files = ['.', 'parquetjs'].flatMap((sub) =>
      readdirSync(path.join(dir, sub), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
        .map((entry) => path.join(sub, entry.name)),
    )

    // The scan must never rot into an always-pass: engine.ts and the parquetjs engine are
    // permanent core files, and the deliberately shallow per-directory readdir would silently
    // skip files moved into a future subdirectory.
    expect(files).toContain('engine.ts')
    expect(files).toContain(path.join('parquetjs', 'parquetjs-engine.ts'))

    const failures = files.flatMap((file) =>
      findDuckdbReferences(readFileSync(path.join(dir, file), 'utf8')).map((v) => `${file}:${v.line}: ${v.statement}`),
    )

    expect(
      failures,
      `the core parquet entry must not know duckdb at all — even type-only. Duckdb code ` +
        `lives behind src/targets/parquet/duckdb/ and imports core, never the reverse:\n${failures.join('\n')}`,
    ).toEqual([])
  })

  it('sanity: the detector flags synthetic violations, including type-only imports', () => {
    expect(findDuckdbReferences("import type { DuckDBInstance } from '@duckdb/node-api'\n")).toEqual([
      { line: 1, statement: "import type { DuckDBInstance } from '@duckdb/node-api'" },
    ])
    expect(findDuckdbReferences("export { duckdbEngine } from './duckdb/index.js'\n")).toEqual([
      { line: 1, statement: "export { duckdbEngine } from './duckdb/index.js'" },
    ])
    expect(findDuckdbReferences("import { duckdbEngine } from '../duckdb/duckdb-engine.js'\n")).toEqual([
      { line: 1, statement: "import { duckdbEngine } from '../duckdb/duckdb-engine.js'" },
    ])
    expect(
      findDuckdbReferences("import { parquetTarget } from './parquet-target.js'\n// see @duckdb/node-api docs\n"),
    ).toEqual([])
  })
})
