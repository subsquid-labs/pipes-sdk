import { type Config, defineConfig } from 'drizzle-kit'
import 'dotenv/config'

export default defineConfig({
  schema: './src/schemas.ts',
  out: './migrations',
  dbCredentials: {
    url:
      process.env.DB_CONNECTION_STR ??
      (() => {
        throw new Error('DB_CONNECTION_STR env missing')
      })(),
  },
  verbose: true,
  strict: true,
  dialect: 'postgresql',
}) satisfies Config
