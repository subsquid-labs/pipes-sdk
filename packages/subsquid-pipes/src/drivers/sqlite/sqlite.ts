export type SqliteOptions = {
  path: string
}

export interface SqliteSync {
  get<T = unknown, P extends any[] = any[]>(sql: string, params?: P): T | null
  all<T = unknown, P extends any[] = any[]>(sql: string, params?: P): T[]
  exec<P extends any[] = any[]>(sql: string, params?: P): void
  stream<P extends any[], R>(sql: string, params?: P): AsyncIterable<R>
}

export async function loadSqlite(options: SqliteOptions): Promise<SqliteSync> {
  if (typeof Bun !== 'undefined') {
    const m = await import('./bun-sqlite.js')
    return new m.BunSQLite(options)
  }

  const m = await import('./node-sqlite.js')
  return new m.NodeSQLite(options)
}
