import Mustache from "mustache"

export const dockerfileTemplate = `
# Multi-stage Dockerfile for pipes-sdk-deploy-test
FROM node:22-slim AS builder

ENV NODE_ENV=production
WORKDIR /app

# Enable corepack (pnpm comes with Node 22)
RUN corepack enable

# System deps to build native modules (e.g., better-sqlite3)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --dangerously-allow-all-builds

# Build sources
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Prune dev dependencies to keep only production ones
RUN pnpm prune --prod

FROM node:22-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

# Enable corepack for completeness (not strictly required at runtime)
RUN corepack enable

# Copy production deps and built files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
{{#isPostgres}}
# Files needed for Postgres migrations
COPY drizzle.config.ts ./drizzle.config.ts
COPY src/schemas.ts ./src/schemas.ts
{{/isPostgres}}

# Default command
CMD ["sh", "-lc", "{{#isPostgres}}pnpm db:generate && pnpm db:migrate && {{/isPostgres}}node dist/index.js"]
`

interface DockerfileTemplateValues {
  isPostgres: boolean
}

export function renderDockerfile(values: DockerfileTemplateValues): string {
  return Mustache.render(dockerfileTemplate, values)
}