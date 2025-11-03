import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: `./schema.ts`,
  out: 'migrations',
  dbCredentials: {
    url: 'postgresql://postgres:postgres@localhost:5432/postgres',
  },
})
