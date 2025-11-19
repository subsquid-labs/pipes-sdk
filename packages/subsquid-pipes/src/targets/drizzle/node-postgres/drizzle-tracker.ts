import { and, eq, Table } from 'drizzle-orm'
import { PgColumn } from 'drizzle-orm/pg-core'
import { BlockCursor } from '~/core/index.js'
import { getDrizzleTableName, SQD_PRIMARY_COLS } from './consts.js'
import { Transaction } from './drizzle-target.js'
import { generateTriggerSQL } from './rollback.js'

/** @internal */
export class DrizzleTracker {
  #knownTables = new Map<Table, boolean>()

  add(table: Table) {
    if (this.#knownTables.has(table)) return

    const from = getDrizzleTableName(table)
    const to = `${from}__snapshots`

    const sql = generateTriggerSQL(from, to, table)

    this.#knownTables.set(table, true)

    return sql
  }

  async cleanup(tx: Transaction, blockNumber: number) {
    for (const table of this.#knownTables.keys()) {
      const from = getDrizzleTableName(table)
      const to = `${from}__snapshots`
      await tx.execute<
        {
          ___sqd__block_number: number
          ___sqd__operation: 'INSERT' | 'UPDATE' | 'DELETE'
        } & Record<string, unknown>
      >(`DELETE FROM "${to}" WHERE "___sqd__block_number" <= ${blockNumber};`)
    }
  }

  async fork(tx: Transaction, cursor: BlockCursor) {
    for (const table of this.#knownTables.keys()) {
      const snapshots = `${getDrizzleTableName(table)}__snapshots`

      const res = await tx.execute<
        {
          ___sqd__block_number: number
          ___sqd__operation: 'INSERT' | 'UPDATE' | 'DELETE'
        } & Record<string, unknown>
      >(
        `SELECT *
         FROM "${snapshots}"
         WHERE "___sqd__block_number" >= ${cursor.number}
         ORDER BY "___sqd__block_number" DESC`,
      )

      for (const row of res.rows) {
        const { ___sqd__block_number, ___sqd__operation, ...snapshot } = row
        const primaryCols: PgColumn[] = (table as any)[SQD_PRIMARY_COLS]

        const filter = and(...primaryCols.map((col) => eq(col, snapshot[col.name])))
        const rowCancelled = Number(___sqd__block_number) !== cursor.number
        switch (___sqd__operation) {
          case 'INSERT':
            if (rowCancelled) {
              await tx.delete(table).where(filter)
            } else {
              await tx.insert(table).values(snapshot).onConflictDoUpdate({
                target: primaryCols,
                set: snapshot,
              })
            }
            break
          case 'UPDATE':
            await tx.insert(table).values(snapshot).onConflictDoUpdate({
              target: primaryCols,
              set: snapshot,
            })
            break
          case 'DELETE':
            if (rowCancelled) {
              await tx.insert(table).values(snapshot).onConflictDoUpdate({
                target: primaryCols,
                set: snapshot,
              })
            } else {
              await tx.delete(table).where(filter)
            }
            break
        }
      }

      // Clean up any remaining snapshots beyond the fork point
      await tx.execute(`DELETE FROM "${snapshots}" WHERE "___sqd__block_number" > ${cursor.number}`)
    }
  }

  wrapTransaction(tx: any): Transaction {
    for (const method of ['insert', 'delete', 'update']) {
      const orig = tx[method].bind(tx)

      tx[method] = (table: Table, ...args: any[]) => {
        if (!this.#knownTables.has(table)) {
          throw new Error(
            `Table "${getDrizzleTableName(table)}" is not tracked for rollbacks. Make sure to include it in the "tables" array when creating the target.`,
          )
        }

        return orig(table, ...args)
      }
    }

    return tx
  }
}
