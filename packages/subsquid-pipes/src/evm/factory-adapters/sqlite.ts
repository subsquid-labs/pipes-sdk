import { loadSqlite, SqliteOptions } from '../../drivers/sqlite/sqlite'
import { FactoryPersistentAdapter } from '../factory'

type Row = {
  address: string
  block_number: number
  event: Buffer
}

type T = { contract: string; blockNumber: number; event: any }

export async function sqliteFactoryDatabase(options: SqliteOptions): Promise<FactoryPersistentAdapter<T>> {
  const db = await loadSqlite(options)

  db.exec(`
    CREATE TABLE IF NOT EXISTS 
        factory(
          address        TEXT,
          block_number   TEXT,
          event          BLOB,
            PRIMARY KEY (address)
        )
  `)

  let lookupCache: Record<string, T | null> = {}

  return {
    all: async (): Promise<T[]> => {
      return db.all<Row>(`SELECT * FROM "factory"`).map((row): T => {
        return {
          contract: row.address,
          blockNumber: row.block_number,
          event: JSON.parse(row.event.toString()),
        }
      })
    },
    lookup: async (address: string) => {
      if (typeof lookupCache[address] !== 'undefined') {
        return lookupCache[address]
      }

      const row = db.get<Row>('SELECT * FROM "factory" WHERE address = ?', [address])
      if (!row) {
        lookupCache[address] = null
        return null
      }

      lookupCache[address] = {
        contract: row.address,
        blockNumber: row.block_number,
        event: JSON.parse(row.event.toString()),
      }

      return lookupCache[address]
    },
    save: async (entities: T[]) => {
      for (const entity of entities) {
        db.exec(`INSERT OR IGNORE INTO factory ('address', 'block_number', 'event') VALUES (?,?,?)`, [
          entity.contract,
          entity.blockNumber,
          JSON.stringify(entity.event),
        ])
      }

      lookupCache = {}
    },
  }
}
