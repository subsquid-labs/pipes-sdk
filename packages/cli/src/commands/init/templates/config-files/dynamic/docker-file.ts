import Mustache from 'mustache'

import { PackageManager, packageManagerTypes } from '~/types/init.js'

export const dockerfileTemplate = `
# Multi-stage Dockerfile for pipes-sdk-deploy-test
FROM {{{image}}} AS builder

WORKDIR /app

{{^isBun}}
# Enable corepack (pnpm comes with Node 22)
RUN corepack enable

{{/isBun}}
# System deps to build native modules (e.g., better-sqlite3)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json {{lockFile}} ./
RUN {{{installCommand}}}

# Build sources
COPY tsconfig.json ./
COPY src ./src
RUN {{packageManager}} run build

FROM {{{image}}} AS runner

WORKDIR /app

{{^isBun}}
# Enable corepack for completeness (not strictly required at runtime)
RUN corepack enable

{{/isBun}}
# Copy production deps and built files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

{{#isPostgres}}
# Files needed for Postgres migrations
COPY migrations ./migrations
COPY drizzle.config.ts ./drizzle.config.ts
COPY src/schemas.ts ./src/schemas.ts
{{/isPostgres}}

{{^isPostgres}}
COPY migrations ./dist/migrations
{{/isPostgres}}
# Default command
CMD ["sh", "-lc", "{{#isPostgres}}{{packageManager}} run db:generate && {{packageManager}} db:migrate && {{/isPostgres}}node dist/index.js"]
`

interface DockerfileTemplateValues {
  isPostgres: boolean
  packageManager: PackageManager
}

const installCommands: Record<PackageManager, string> = {
  pnpm: 'pnpm install --frozen-lockfile --dangerously-allow-all-builds',
  bun: 'bun install --frozen-lockfile',
  npm: 'npm ci',
  yarn: 'yarn config set nodeLinker node-modules && yarn install --immutable',
} as const

export function renderDockerfile(values: DockerfileTemplateValues): string {
  const packageManager = packageManagerTypes.find((p) => p.name === values.packageManager)

  if (!packageManager) throw new Error(`Invalid package manager: ${packageManager}`)

  return Mustache.render(dockerfileTemplate, {
    ...values,
    lockFile: packageManager.lockFile,
    isBun: values.packageManager === 'bun',
    installCommand: installCommands[values.packageManager],
    image: values.packageManager === 'bun' ? 'oven/bun:1' : 'node:22-slim',
  })
}
