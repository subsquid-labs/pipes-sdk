import { describe, expect, it } from 'vitest'

import { renderDockerfile } from './docker-file.js'

describe('Dockerfile generation', () => {
  it('generates Dockerfile for pnpm', () => {
    const dockerFile = renderDockerfile({
      isPostgres: true,
      packageManager: 'pnpm',
    })

    expect(dockerFile).toMatchInlineSnapshot(`
      "
      # Multi-stage Dockerfile for pipes-sdk-deploy-test
      FROM node:22-slim AS builder

      ENV NODE_ENV=production
      WORKDIR /app

      # Enable corepack (pnpm comes with Node 22)
      RUN corepack enable

      # System deps to build native modules (e.g., better-sqlite3)
      RUN apt-get update   && apt-get install -y --no-install-recommends python3 make g++   && rm -rf /var/lib/apt/lists/*

      # Install dependencies
      COPY package.json pnpm-lock.yaml ./
      RUN pnpm install --prod --frozen-lockfile --dangerously-allow-all-builds

      # Build sources
      COPY tsconfig.json ./
      COPY src ./src
      RUN pnpm run build

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

      # Files needed for Postgres migrations
      COPY migrations ./migrations
      COPY drizzle.config.ts ./drizzle.config.ts
      COPY src/schemas.ts ./src/schemas.ts

      # Default command
      CMD ["sh", "-lc", "pnpm run db:generate && pnpm db:migrate && node dist/index.js"]
      "
    `)
  })

  it('generates Dockerfile for npm', () => {
    const dockerFile = renderDockerfile({
      isPostgres: true,
      packageManager: 'npm',
    })
    expect(dockerFile).toMatchInlineSnapshot(`
      "
      # Multi-stage Dockerfile for pipes-sdk-deploy-test
      FROM node:22-slim AS builder

      ENV NODE_ENV=production
      WORKDIR /app

      # Enable corepack (pnpm comes with Node 22)
      RUN corepack enable

      # System deps to build native modules (e.g., better-sqlite3)
      RUN apt-get update   && apt-get install -y --no-install-recommends python3 make g++   && rm -rf /var/lib/apt/lists/*

      # Install dependencies
      COPY package.json package-lock.json ./
      RUN npm ci --omit=dev

      # Build sources
      COPY tsconfig.json ./
      COPY src ./src
      RUN npm run build

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

      # Files needed for Postgres migrations
      COPY migrations ./migrations
      COPY drizzle.config.ts ./drizzle.config.ts
      COPY src/schemas.ts ./src/schemas.ts

      # Default command
      CMD ["sh", "-lc", "npm run db:generate && npm db:migrate && node dist/index.js"]
      "
    `)
  })

  it('generates Dockerfile for bun', () => {
    const dockerFile = renderDockerfile({
      isPostgres: true,
      packageManager: 'bun',
    })
    expect(dockerFile).toMatchInlineSnapshot(`
      "
      # Multi-stage Dockerfile for pipes-sdk-deploy-test
      FROM oven/bun:1 AS builder

      ENV NODE_ENV=production
      WORKDIR /app

      # System deps to build native modules (e.g., better-sqlite3)
      RUN apt-get update   && apt-get install -y --no-install-recommends python3 make g++   && rm -rf /var/lib/apt/lists/*

      # Install dependencies
      COPY package.json bun.lock ./
      RUN bun install --production --frozen-lockfile

      # Build sources
      COPY tsconfig.json ./
      COPY src ./src
      RUN bun run build

      FROM oven/bun:1 AS runner

      ENV NODE_ENV=production
      WORKDIR /app

      # Copy production deps and built files from builder
      COPY --from=builder /app/node_modules ./node_modules
      COPY --from=builder /app/package.json ./package.json
      COPY --from=builder /app/dist ./dist
      COPY migrations ./migrations

      # Files needed for Postgres migrations
      COPY migrations ./migrations
      COPY drizzle.config.ts ./drizzle.config.ts
      COPY src/schemas.ts ./src/schemas.ts

      # Default command
      CMD ["sh", "-lc", "bun run db:generate && bun db:migrate && node dist/index.js"]
      "
    `)
  })

  it('generates Dockerfile for yarn', () => {
    const dockerFile = renderDockerfile({
      isPostgres: true,
      packageManager: 'yarn',
    })
    expect(dockerFile).toMatchInlineSnapshot(`
      "
      # Multi-stage Dockerfile for pipes-sdk-deploy-test
      FROM node:22-slim AS builder

      ENV NODE_ENV=production
      WORKDIR /app

      # Enable corepack (pnpm comes with Node 22)
      RUN corepack enable

      # System deps to build native modules (e.g., better-sqlite3)
      RUN apt-get update   && apt-get install -y --no-install-recommends python3 make g++   && rm -rf /var/lib/apt/lists/*

      # Install dependencies
      COPY package.json yarn.lock ./
      RUN yarn workspaces focus --production

      # Build sources
      COPY tsconfig.json ./
      COPY src ./src
      RUN yarn run build

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

      # Files needed for Postgres migrations
      COPY migrations ./migrations
      COPY drizzle.config.ts ./drizzle.config.ts
      COPY src/schemas.ts ./src/schemas.ts

      # Default command
      CMD ["sh", "-lc", "yarn run db:generate && yarn db:migrate && node dist/index.js"]
      "
    `)
  })
})
