import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { loadSqlite, SqliteOptions } from '~/drivers/sqlite/sqlite.js'
import { PortalCacheAdapter, SaveBatch } from '../../portal-cache.js'

export async function sqliteCacheAdapter(options: SqliteOptions): Promise<PortalCacheAdapter> {
  await mkdir(path.dirname(options.path), { recursive: true })

  const db = await loadSqlite(options)

  db.exec(`
    CREATE TABLE IF NOT EXISTS 
        data(
          query_hash     TEXT,
          block_from     INTEGER,
          block_to       INTEGER,
          value          BLOB,
            PRIMARY KEY (block_from, block_to, query_hash)
        )
  `)

  const insert = 'INSERT INTO "data" ("block_from", "block_to", "query_hash", "value") VALUES (?, ?, ?, ?)'
  const select = 'SELECT * FROM "data" WHERE "block_from" >= ? and "query_hash" = ? ORDER BY "block_from" ASC'

  return {
    async *stream({ cursor, queryHash }) {
      for await (const message of db.stream<[number, string], { value: Buffer }>(select, [cursor.number, queryHash])) {
        yield message.value
      }
    },
    async save({ queryHash, cursors, data }: SaveBatch) {
      db.exec(insert, [cursors.first.number, cursors.last.number, queryHash, data])
    },
  }
}
