import { Column, Table } from 'drizzle-orm'
import { Reference } from 'drizzle-orm/pg-core/foreign-keys'

const DRIZZLE_TABLE_NAME = Symbol.for('drizzle:BaseName')
const IS_DRIZZLE_TABLE = Symbol.for('drizzle:IsDrizzleTable')
const DRIZZLE_TABLE_COLS = Symbol.for('drizzle:Columns')
const DRIZZLE_TABLE_EXTRA_BUILDER = Symbol.for('drizzle:ExtraConfigBuilder')
const DRIZZLE_TABLE_EXTRA_COLUMNS = Symbol.for('drizzle:ExtraConfigColumns')
const DRIZZLE_INLINE_FOREIGN_KEYS = Symbol.for('drizzle:PgInlineForeignKeys')
export const SQD_PRIMARY_COLS = Symbol.for('sqd:PrimaryColumns')

export function isDrizzleTable(table: unknown) {
  if (!table || (typeof table !== 'object' && typeof table !== 'function')) return false

  const isDrizzleTable = (table as any)[IS_DRIZZLE_TABLE]

  return isDrizzleTable === true
}

export function getDrizzleTableName(table: Table): string {
  return ((table as any)[DRIZZLE_TABLE_NAME] as string) || 'unknown'
}

export function getDrizzleTableColumns(table: Table) {
  return ((table as any)[DRIZZLE_TABLE_COLS] as Record<string, Column>) || {}
}

export function getDrizzleTableExtraConfig(table: Table) {
  return (table as any)[DRIZZLE_TABLE_EXTRA_BUILDER] as (columns: Record<string, Column>) => unknown[]
}

export function getDrizzleTableExtraColumns(table: Table) {
  return ((table as any)[DRIZZLE_TABLE_EXTRA_COLUMNS] as Record<string, Column>) || {}
}

export function getDrizzleForeignKeys(table: Table) {
  return (
    ((table as any)[DRIZZLE_INLINE_FOREIGN_KEYS] as {
      table: Table
      reference: Reference
    }[]) || []
  )
}
