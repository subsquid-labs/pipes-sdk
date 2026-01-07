import Mustache from 'mustache'

export const packageJsonTemplate = `{
  "name": "{{projectName}}",
  "version": "0.0.1",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsup src/index.ts --format esm --dts",
    "lint": "biome check . --write",
    "format": "biome format . --write"{{#hasPostgresScripts}},
    "db:generate": "pnpm drizzle-kit generate",
    "db:migrate": "pnpm drizzle-kit migrate",
    "db:push": "pnpm drizzle-kit push"{{/hasPostgresScripts}}
  },
  "dependencies": {{{dependenciesJson}}},
  "devDependencies": {{{devDependenciesJson}}}
}`

function formatDependencies(deps: Record<string, string>): string {
  const entries = Object.entries(deps)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, version]) => `    "${name}": "${version}"`)
  return `{\n${entries.join(',\n')}\n  }`
}

export function renderPackageJson(
  projectName: string,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
  hasPostgresScripts: boolean,
): string {
  return Mustache.render(packageJsonTemplate, {
    projectName,
    dependenciesJson: formatDependencies(dependencies),
    devDependenciesJson: formatDependencies(devDependencies),
    hasPostgresScripts,
  })
}