import type { OracleRow, OracleState } from './reference-model.js'
import type { PublishedUnit } from './validators.js'

/**
 * Reads a sink's committed state and data back out of its store, so the oracle can be diffed
 * against what actually landed rather than against what the pipe reported (12 §harness rule).
 *
 * One interface across bindings: the comparison logic in a conformance suite must not know which
 * engine it is looking at. Per-binding format details live behind `readState` (IB-20…IB-26).
 */
export type SinkProbe = {
  /** Engine label, for failure messages. */
  readonly binding: string
  /** Persisted state, or undefined when the sink has never committed. */
  readState(): Promise<OracleState | undefined>
  /** Committed rows for one table, ascending by attribution. */
  readRows(table: string): Promise<OracleRow[]>
  /** Published units and the windows they claim. File sinks only. */
  readUnits?(table: string): Promise<PublishedUnit[]>
}

/** Highest block the probe's committed data reaches, for the INV-5 watermark check. */
export async function dataBound(probe: SinkProbe, tables: readonly string[]): Promise<number | undefined> {
  let bound: number | undefined

  for (const table of tables) {
    for (const row of await probe.readRows(table)) {
      if (bound === undefined || row.block > bound) {
        bound = row.block
      }
    }
  }

  return bound
}

/** Every committed row across `tables`, ascending by attribution then table. */
export async function allRows(probe: SinkProbe, tables: readonly string[]): Promise<OracleRow[]> {
  const rows: OracleRow[] = []
  for (const table of tables) {
    rows.push(...(await probe.readRows(table)))
  }

  return rows.sort((a, b) => a.block - b.block || a.table.localeCompare(b.table))
}
