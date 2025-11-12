import { is, Table } from 'drizzle-orm'
import { PrimaryKeyBuilder } from 'drizzle-orm/pg-core'
import {
  getDrizzleForeignKeys,
  getDrizzleTableColumns,
  getDrizzleTableExtraColumns,
  getDrizzleTableExtraConfig,
  getDrizzleTableName,
  SQD_PRIMARY_COLS,
} from './consts.js'

export function generateTriggerSQL(from: string, to: string, table: Table) {
  const columns = getDrizzleTableColumns(table)

  const colsDDL = Object.entries(columns)
    .map(([name, col]) => `"${name}" ${col.getSQLType()}`)
    .join(',\n  ')

  let primaryCols = Object.values(columns).filter((c) => c.primary)
  if (primaryCols.length === 0) {
    const extraConfigFn = getDrizzleTableExtraConfig(table)

    if (extraConfigFn) {
      const extra = extraConfigFn(getDrizzleTableExtraColumns(table))

      for (const fn of extra) {
        if (!is(fn, PrimaryKeyBuilder)) continue

        const primaryKeyBuilder = fn as any

        primaryCols = primaryKeyBuilder.columns
      }
    }
  }

  if (primaryCols.length === 0) {
    throw new Error(`Cannot generate snapshot trigger for table ${from} without primary key columns`)
  }

  ;(table as any)[SQD_PRIMARY_COLS] = primaryCols

  const primaryKey = [{ name: '___sqd__block_number' }, ...primaryCols].map((c) => `"${c.name}"`).join(',')

  const colNames = Object.keys(columns)
    .map((c) => `"${c}"`)
    .join(', ')
  const oldCols = Object.keys(columns)
    .map((c) => `OLD."${c}"`)
    .join(', ')
  const newCols = Object.keys(columns)
    .map((c) => `NEW."${c}"`)
    .join(', ')

  return `
-- ===== SNAPSHOT SETUP FOR ${to} =====
CREATE TABLE IF NOT EXISTS "${to}" (
  ${colsDDL},
  "___sqd__operation" TEXT NOT NULL,
  "___sqd__block_number" BIGINT NOT NULL,
  PRIMARY KEY (${primaryKey})
);

CREATE OR REPLACE FUNCTION maybe_snapshot_${from}() RETURNS trigger AS $$
DECLARE
  snapshot_enabled BOOLEAN := COALESCE(NULLIF(current_setting('sqd.snapshot_enabled', true), '')::boolean, false);
  block_num BIGINT := COALESCE(NULLIF(current_setting('sqd.snapshot_block_number', true), '')::BIGINT, -1);
BEGIN
   IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN
     IF snapshot_enabled = true THEN
        INSERT INTO "${to}" (${colNames}, "___sqd__block_number", "___sqd__operation")
        VALUES (${newCols}, block_num, TG_OP)
        ON CONFLICT (${primaryKey}) DO UPDATE SET
        "___sqd__operation" = TG_OP, ${Object.keys(columns)
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(', ')};
     END IF;
     RETURN NEW;
   ELSIF  TG_OP = 'DELETE' THEN
      IF snapshot_enabled = true THEN
        INSERT INTO "${to}" (${colNames}, "___sqd__block_number", "___sqd__operation")
        VALUES (${oldCols}, block_num, TG_OP)
        ON CONFLICT (${primaryKey}) DO UPDATE SET
        "___sqd__operation" = TG_OP, ${Object.keys(columns)
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(', ')};
      END IF;
      RETURN OLD;
   END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ${from}_snapshot_trigger ON "${from}";

CREATE TRIGGER ${from}_snapshot_trigger
AFTER INSERT OR UPDATE OR DELETE ON "${from}"
FOR EACH ROW EXECUTE FUNCTION maybe_snapshot_${from}();
`
}

/**
 * Returns tables ordered for DELETE operations: children → parents.
 * Edge: parent -> child (table B has FK to A => A -> B).
 * We topologically sort and then reverse to get delete order.
 */
export function orderTablesForDelete(tables: Table[]): Table[] {
  const nameOf = (t: Table) => getDrizzleTableName(t)
  const byName = new Map<string, Table>()
  for (const t of tables) byName.set(nameOf(t), t)

  const nodes = new Set<string>()
  const adj = new Map<string, Set<string>>()
  const indeg = new Map<string, number>()

  for (const t of tables) {
    const tn = nameOf(t)
    nodes.add(tn)
    if (!adj.has(tn)) adj.set(tn, new Set())
    if (!indeg.has(tn)) indeg.set(tn, 0)
  }

  for (const child of tables) {
    const childName = nameOf(child)
    const fks = getDrizzleForeignKeys(child)
    for (const fk of fks) {
      const parent = fk.reference().foreignTable as Table
      const parentName = nameOf(parent)
      if (!byName.has(parentName) || !byName.has(childName)) continue
      if (!adj.get(parentName)!.has(childName)) {
        adj.get(parentName)!.add(childName)
        indeg.set(childName, (indeg.get(childName) ?? 0) + 1)
      }
      if (!adj.has(parentName)) adj.set(parentName, new Set())
      if (!indeg.has(parentName)) indeg.set(parentName, 0)
    }
  }

  // Kahn's algorithm to get parent -> child order
  const q: string[] = []
  for (const [n, d] of indeg) if (d === 0) q.push(n)
  const order: string[] = []
  while (q.length) {
    const u = q.shift()!
    order.push(u)
    for (const v of adj.get(u) ?? []) {
      indeg.set(v, (indeg.get(v) ?? 0) - 1)
      if ((indeg.get(v) ?? 0) === 0) q.push(v)
    }
  }

  if (order.length !== nodes.size) {
    throw new Error(
      [
        'Circular dependency detected in foreign key references.',
        'Cannot determine a safe order for delete operations.',
        'Please check your table definitions for circular foreign key constraints.',
      ].join('\n'),
    )
  }

  // Reverse to get children→parents
  return order.reverse().map((n) => byName.get(n)!)
}
