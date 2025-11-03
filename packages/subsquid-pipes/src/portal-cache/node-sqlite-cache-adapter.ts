import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { loadSqlite, SqliteSync } from '~/drivers/sqlite/sqlite.js'
import { Options, PortalCacheNodeJs, SaveBatch, StreamBatch } from './node-portal-cache.js'

export type PortalSqliteCacheOptions = Options<{ path: string }>

class PortalSqliteCache extends PortalCacheNodeJs<PortalSqliteCacheOptions> {
  #initialized = false
  #db!: SqliteSync
  #statements = {
    table: `CREATE TABLE IF NOT EXISTS data
    (
        query_hash TEXT,
        block_from INTEGER,
        block_to   INTEGER,
        value      BLOB,
        PRIMARY KEY ("block_from", "block_to", "query_hash")
    )`,
    insert: 'INSERT INTO "data" ("block_from", "block_to", "query_hash", "value") VALUES (?, ?, ?, ?)',
    select: 'SELECT * FROM "data" WHERE "block_from" >= ? and "query_hash" = ? ORDER BY "block_from" ASC',
  }

  constructor(options: PortalSqliteCacheOptions) {
    super(options)
  }

  private async createDb(): Promise<void> {
    if (this.#initialized) return

    await mkdir(path.dirname(this.options.path), { recursive: true })
    this.#db = await loadSqlite(this.options)
    this.#db.exec(this.#statements.table)
    this.#initialized = true
  }

  async *stream({ fromBlock, queryHash }: StreamBatch) {
    await this.createDb()

    for await (const message of this.#db.stream<[number, string], { value: Buffer }>(this.#statements.select, [
      fromBlock,
      queryHash,
    ])) {
      yield message.value
    }
  }

  protected async save({ queryHash, cursors, data }: SaveBatch) {
    await this.createDb()

    this.#db.exec(this.#statements.insert, [cursors.first.number, cursors.last.number, queryHash, data])
  }
}

export function createSqlitePortalCache(opts: PortalSqliteCacheOptions) {
  return new PortalSqliteCache(opts)
}
