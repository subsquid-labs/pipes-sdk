import Mustache from 'mustache'

import { PackageManager } from '~/types/init.js'

const packageJsonTemplate = `{
  "name": "{{projectName}}",
  "version": "0.0.1",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsup src/index.ts --format esm --dts",
    "lint": "biome check . --write"{{#hasPostgresScripts}},
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push"{{/hasPostgresScripts}}
  },
  {{#isBun}}
    "trustedDependencies": [
    "better-sqlite3",
    "bufferutil",
    "es5-ext",
    "keccak",
    "utf-8-validate"
  ],
  {{/isBun}}
  "dependencies": {{{dependencies}}},
  "devDependencies": {{{devDependencies}}}
}`

function formatDependencies(deps: Record<string, string>): string {
  const entries = Object.entries(deps)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => `    "${name}": "${version}"`)
  return `{\n${entries.join(',\n')}\n  }`
}

interface PackageJsonTemplateValues {
  projectName: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  hasPostgresScripts: boolean
  packageManager: PackageManager
}

export function renderPackageJson(values: PackageJsonTemplateValues): string {
  return Mustache.render(packageJsonTemplate, {
    ...values,
    dependencies: formatDependencies(values.dependencies),
    devDependencies: formatDependencies(values.devDependencies),
    isBun: values.packageManager === 'bun',
  })
}
