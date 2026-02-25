import { loadSqlite, SqliteOptions, SqliteSync } from '~/drivers/sqlite/sqlite.js'

import { Token } from '../types.js'
import { TokenStore } from './types.js'

type Row = {
  address: string
  decimals: number
  symbol: string
  name: string
}

export class SqliteTokenStore implements TokenStore {
  constructor(private db: SqliteSync) {}

  static async create(options: SqliteOptions): Promise<SqliteTokenStore> {
    const db = await loadSqlite(options)
    const store = new SqliteTokenStore(db)
    store.migrate()
    return store
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evm_tokens (
        address TEXT PRIMARY KEY,
        decimals INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL
      )
    `)
  }

  async save(tokens: Token[]): Promise<void> {
    if (!tokens.length) return

    this.db.exec('BEGIN TRANSACTION')
    try {
      for (const token of tokens) {
        this.db.exec(
          `INSERT OR REPLACE INTO evm_tokens (address, decimals, symbol, name) VALUES (?, ?, ?, ?)`,
          [token.address, token.decimals, token.symbol ?? '', token.name ?? ''],
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async get(addresses: string[]): Promise<Record<string, Token>> {
    if (!addresses.length) return {}

    const placeholders = addresses.map(() => '?').join(', ')
    const rows = this.db.all<Row>(
      `SELECT address, decimals, symbol, name FROM evm_tokens WHERE address IN (${placeholders})`,
      addresses,
    )

    return rows.reduce<Record<string, Token>>((res, row) => {
      res[row.address] = {
        address: row.address,
        decimals: row.decimals,
        symbol: row.symbol,
        name: row.name,
      }
      return res
    }, {})
  }
}
