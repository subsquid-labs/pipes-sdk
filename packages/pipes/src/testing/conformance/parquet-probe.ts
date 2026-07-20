import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { ParquetReader } from '@dsnp/parquetjs'

import type { OracleRow, OracleState } from './reference-model.js'
import type { SinkProbe } from './store-probe.js'
import type { PublishedUnit } from './validators.js'

/** Published data files are named `<min>-<max>.parquet` (IB-22). */
const DATA_FILE_RE = /^(\d+)-(\d+)\.parquet$/
const STATE_BASENAME = '_sqd_parquet_state'

export type ParquetProbeOptions = {
  dir: string
  tables: string[]
  /** Pipe namespace; the state file is `_sqd_parquet_state.<id>.json` when set. */
  id?: string
  /** Column carrying block attribution (INV-3). */
  blockColumn?: string
}

/**
 * Class-K (checkpointed-immutable) store probe: the durable state file plus the published Parquet
 * units, read straight off disk.
 *
 * Windows come from the filename, which on mainline is the row min/max rather than a coverage
 * window — so `items-belong-to-parent` holds here by construction and only becomes load-bearing
 * once coverage-window naming lands (GAP-17).
 */
export function parquetProbe({ dir, tables, id, blockColumn = 'blockNumber' }: ParquetProbeOptions): SinkProbe {
  const statePath = path.join(dir, id ? `${STATE_BASENAME}.${id}.json` : `${STATE_BASENAME}.json`)

  const readUnits = async (table: string): Promise<PublishedUnit[]> => {
    const entries = await readdir(path.join(dir, table)).catch(() => [] as string[])
    const units: PublishedUnit[] = []

    for (const name of entries.sort()) {
      const match = DATA_FILE_RE.exec(name)
      if (!match) {
        continue
      }

      units.push({
        name,
        from: Number.parseInt(match[1], 10),
        to: Number.parseInt(match[2], 10),
        rows: await readUnitRows(path.join(dir, table, name), table, blockColumn),
      })
    }

    return units
  }

  return {
    binding: 'parquet',

    async readState(): Promise<OracleState | undefined> {
      let raw: string
      try {
        raw = await readFile(statePath, 'utf8')
      } catch {
        return undefined
      }

      const parsed = JSON.parse(raw)

      // Class K persists no rollback chain: only finalized rows are ever written, so there is
      // nothing above the floor to roll back (CN-12).
      return {
        current: parsed.cursor,
        finalized: parsed.finalized ?? undefined,
        rollbackChain: [],
      }
    },

    async readRows(table: string): Promise<OracleRow[]> {
      const units = await readUnits(table)

      return units.flatMap((unit) => unit.rows as OracleRow[]).sort((a, b) => a.block - b.block)
    },

    readUnits,
  }
}

async function readUnitRows(filePath: string, table: string, blockColumn: string): Promise<OracleRow[]> {
  const reader = await ParquetReader.openFile(filePath)
  const rows: OracleRow[] = []

  try {
    const cursor = reader.getCursor()
    let raw: Record<string, unknown> | null
    while ((raw = (await cursor.next()) as Record<string, unknown> | null)) {
      rows.push({ table, block: Number(raw[blockColumn]), value: normalize(raw) })
    }
  } finally {
    await reader.close()
  }

  return rows
}

/** Parquet returns INT64 as BigInt; normalise so oracle comparison is not width-sensitive. */
function normalize(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]),
  )
}
