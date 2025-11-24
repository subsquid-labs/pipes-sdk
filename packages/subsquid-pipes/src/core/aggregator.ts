import { loadSqlite, SqliteSync } from '../drivers/sqlite/sqlite.js'
import { createTransformer } from './transformer.js'

function chunks<T>(arr: T[], size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('chunks: size must be a positive finite number')
  }
  const res: T[][] = []
  if (!arr || arr.length === 0) return res
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size))
  }
  return res
}

class Storage {
  #db!: SqliteSync

  constructor(protected options: { path: string }) {}

  async init() {
    this.#db = await loadSqlite({ path: this.options.path })

    this.#db.exec(`PRAGMA journal_mode=WAL; `)
    this.#db.exec(`
        CREATE TABLE IF NOT EXISTS 
            aggregators(
              id            TEXT,
              key           TEXT,
              value         TEXT,
                PRIMARY KEY (id, key)
            )
      `)
  }
  load(id: string, key: string) {
    return this.#db.get<{ value: string }>(`SELECT value FROM aggregators WHERE id = ? and key = ?`, [id, key])?.value
  }
  persist(data: { id: string; key: string; value: string }[]) {
    const c = chunks(data, 2000)
    for (const chunk of c) {
      const params = new Array(chunk.length).fill('(?,?,?)').join(',')
      this.#db.exec(
        `INSERT OR REPLACE INTO aggregators (id, key, value) VALUES ${params}`,
        chunk.flatMap((d) => [d.id, d.key, d.value]),
      )
    }
  }
}

class Aggregator<T, V> {
  protected finalized?: V
  protected unfinalized: V[] = []

  constructor(
    protected implementation: {
      getter: (data: T) => V
      updateFinalValue: (value: V, prevValue?: V) => V
      calculate: (unfinalized: V[], finalized?: V) => V
    },
  ) {}

  aggregate(item: T, finalized: boolean) {
    const value = this.implementation.getter(item)
    if (finalized) {
      this.finalized = this.implementation.updateFinalValue(value, this.finalized)
    } else {
      this.unfinalized.push(value)
    }
  }

  calculate(): V {
    return this.implementation.calculate(this.unfinalized || [], this.finalized)
  }

  serialize(): string {
    return JSON.stringify({
      finalized: this.finalized,
      unfinalized: this.unfinalized,
    })
  }

  deserialize(data: string) {
    const obj = JSON.parse(data)

    this.finalized = obj.finalized
    this.unfinalized = obj.unfinalized || []

    return this
  }

  resetFromState(state?: string) {
    return this.deserialize(state || '{}')
  }
}

export function sum<T>(getter: (item: T) => number) {
  return new Aggregator<T, number>({
    getter,
    updateFinalValue: (value, prev = 0) => prev + value,
    calculate: (unfinalized, finalized = 0) => finalized + unfinalized.reduce((a, b) => a + b, 0),
  })
}

export function min<T>(getter: (item: T) => number) {
  return new Aggregator<T, number>({
    getter,
    updateFinalValue: (value, prev = Infinity) => Math.min(value, prev),
    calculate: (unfinalized, finalized = Infinity) => Math.min(finalized, ...unfinalized),
  })
}
export function max<T>(getter: (item: T) => number) {
  return new Aggregator<T, number>({
    getter,
    updateFinalValue: (value, prev = -Infinity) => Math.max(value, prev),
    calculate: (unfinalized, finalized = -Infinity) => Math.max(finalized, ...unfinalized),
  })
}

export function last<T, R>(getter: (item: T) => R) {
  return new Aggregator<T, R | undefined>({
    getter,
    updateFinalValue: (value) => value,
    calculate: (unfinalized, finalized) => {
      if (unfinalized.length) return unfinalized[unfinalized.length - 1]

      return finalized
    },
  })
}

export function first<T, R>(getter: (item: T) => R) {
  return new Aggregator<T, R | undefined>({
    getter,
    updateFinalValue: (value, prev) => prev || value,
    calculate: (unfinalized, finalized) => {
      if (finalized) return finalized

      return unfinalized[0]
    },
  })
}

function getId({ window, group }: { window?: Date; group?: string }) {
  return `${group || 'default'}:${window?.toISOString() || 'all'}`
}

export function createAggregator<
  T extends { blockNumber: number },
  Agg extends Record<string, Aggregator<T, any>>,
  Out = { [K in keyof Agg]: Agg[K] extends Aggregator<any, infer Out> ? Out : never },
>({
  dbPath,
  aggregate,
  groupBy,
  window,
}: {
  dbPath: string
  aggregate: Agg
  groupBy: (item: T) => string
  window?: (item: T) => Date
}) {
  let storage: Storage

  return createTransformer<T[], Out[]>({
    profiler: { id: 'aggregator' },
    start: async () => {
      storage = new Storage({ path: dbPath })
      await storage.init()
    },
    transform: (data, ctx) => {
      const res: Record<string, Out> = {}
      const aggregators: Record<string, Agg> = {}

      ctx.profiler.measureSync('load state', () => {
        for (const item of data) {
          const id = getId({
            group: groupBy(item),
            window: window?.(item),
          })
          if (!aggregators[id]) {
            aggregators[id] = {} as Agg
            for (const key in aggregate) {
              if (!aggregators[id][key]) {
                aggregators[id][key] = aggregate[key].resetFromState(storage.load(id, key))
              }
            }
          }
        }
      })

      ctx.profiler.measureSync('calculations', () => {
        for (const item of data) {
          const id = getId({
            group: groupBy(item),
            window: window?.(item),
          })
          for (const key in aggregate) {
            const finalized = ctx.head.finalized ? item.blockNumber <= ctx.head.finalized?.number : true

            aggregators[id][key].aggregate(item, finalized)

            if (!res[id]) {
              res[id] = { id } as Out
            }
            // @ts-ignore
            res[id][key] = aggregators[id][key].calculate()
          }
        }
      })

      ctx.profiler.measureSync('persist state', () => {
        const update: { id: string; key: string; value: string }[] = []
        for (const id in aggregators) {
          for (const key in aggregators[id]) {
            update.push({ id, key, value: aggregators[id][key].serialize() })
          }
        }

        storage.persist(update)
      })

      return Object.values(res)
    },
  })
}
