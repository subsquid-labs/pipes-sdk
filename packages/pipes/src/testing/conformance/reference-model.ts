import type { BlockRef } from '../portal-wire.js'

/**
 * Durability classes per CN-10…CN-14. `ephemeral` is the spec's class ∅ — no persistence, kept as
 * the executable minimal model of the hold-back contract.
 */
export type DurabilityClass = 'T' | 'W' | 'K' | 'A' | 'ephemeral'

/** Classes that write only finalized rows, through the hold-back buffer (DEF-15). */
const DEFERRED: ReadonlySet<DurabilityClass> = new Set<DurabilityClass>(['K', 'ephemeral'])

export type Cursor = BlockRef & { timestamp?: number }

/** A committed row, reduced to what the oracle compares: where it belongs and what it holds. */
export type OracleRow = {
  table: string
  /** Block the row is attributed to (INV-3). */
  block: number
  value: unknown
}

export type OracleState = {
  /** Committed cursor. */
  current: Cursor | undefined
  /** Monotonic finalized floor. */
  finalized: Cursor | undefined
  /** Rollback chain: processed blocks above the floor. */
  rollbackChain: Cursor[]
}

export type PersistedState = OracleState & {
  /** Next window start per table (file sinks, INV-4). */
  coverage?: Record<string, number>
  /** Prior rollback records, oldest first. Defaults to one record built from the state itself. */
  history?: RollbackRecord[]
}

/** One historical commit's rollback state — the unit WP-42's ancestor search walks. */
export type RollbackRecord = {
  rollbackChain: Cursor[]
  finalized?: Cursor
}

export const ORACLE_ERRORS = {
  STATE_MALFORMED: 'ORACLE_STATE_MALFORMED',
  ROWS_ABOVE_CURSOR: 'ORACLE_ROWS_ABOVE_CURSOR',
  NOT_ASCENDING: 'ORACLE_NOT_ASCENDING',
  NOT_LINKED: 'ORACLE_NOT_LINKED',
  OUT_OF_RANGE: 'ORACLE_OUT_OF_RANGE',
  EMPTY_CANONICAL: 'ORACLE_EMPTY_CANONICAL',
  CANONICAL_BELOW_CURSOR: 'ORACLE_CANONICAL_BELOW_CURSOR',
  FINALITY_CONFLICT: 'ORACLE_FINALITY_CONFLICT',
  NO_ANCESTOR: 'ORACLE_NO_ANCESTOR',
  INVARIANT: 'ORACLE_INVARIANT',
} as const

export type OracleErrorCode = (typeof ORACLE_ERRORS)[keyof typeof ORACLE_ERRORS]

export class OracleError extends Error {
  constructor(
    readonly code: OracleErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OracleError'
  }
}

export type ReferenceModelOptions = {
  durability: DurabilityClass
  /** Pure per RS-10: same blocks in, same rows out. Default emits one row per block. */
  transform?: (block: Cursor) => OracleRow[]
  /** Configured range, when known — enables the INV-3 in-range and INV-20 linkage checks. */
  range?: { from: number; to?: number }
}

/**
 * The oracle: the spec's normative reference model, executable.
 *
 * It is deliberately a transcription of the pseudocode in spec/13 rather than a second
 * implementation — every divergence from the SUT is meant to be a finding about the SUT or about
 * the spec, never about a clever shortcut taken here.
 *
 * It pins only what the spec declares deterministic. The free variables — batch partitioning,
 * flush and checkpoint timing, published-unit boundaries, retry pacing, log text — are never
 * asserted, so a conforming implementation may vary them without failing a comparison.
 */
export class ReferenceModel {
  readonly #durability: DurabilityClass
  readonly #transform: (block: Cursor) => OracleRow[]
  readonly #range: { from: number; to?: number } | undefined

  #current: Cursor | undefined
  #finalized: Cursor | undefined
  #rollbackChain: Cursor[] = []
  /**
   * Every rollback record ever committed, oldest first.
   *
   * WP-42 searches the persisted *records*, each with its own chain and its own floor — not just
   * the current chain. The distinction is load-bearing: INV-1 keeps every entry of the current
   * chain strictly above the current floor, so against that chain alone WP-44's finality conflict
   * can never trigger. Only an older record, written under a lower floor, can reach below it.
   */
  #history: RollbackRecord[] = []
  /** Committed, reader-visible rows. */
  #data: OracleRow[] = []
  /** Hold-back buffer: rows awaiting finality (deferred classes only). */
  #buffer: OracleRow[] = []
  #coverage: Record<string, number> = {}

  constructor(options: ReferenceModelOptions) {
    this.#durability = options.durability
    this.#range = options.range
    this.#transform =
      options.transform ?? ((block) => [{ table: 'blocks', block: block.number, value: { hash: block.hash } }])
  }

  get durability(): DurabilityClass {
    return this.#durability
  }

  /** Reader-visible rows, in commit order. */
  get data(): readonly OracleRow[] {
    return this.#data
  }

  /** Rows held back awaiting finality. */
  get buffered(): readonly OracleRow[] {
    return this.#buffer
  }

  get coverage(): Readonly<Record<string, number>> {
    return this.#coverage
  }

  /** T-INIT — adopt persisted state and repair, then assert the recovery invariant. */
  recover(persisted: PersistedState | undefined): void {
    if (!persisted) {
      return
    }

    if (persisted.current && typeof persisted.current.number !== 'number') {
      throw new OracleError(ORACLE_ERRORS.STATE_MALFORMED, 'persisted cursor has no block number')
    }

    this.#current = persisted.current
    this.#finalized = persisted.finalized
    this.#rollbackChain = [...(persisted.rollbackChain ?? [])]
    this.#coverage = { ...(persisted.coverage ?? {}) }
    this.#history = persisted.history
      ? [...persisted.history]
      : this.#rollbackChain.length
        ? [{ rollbackChain: [...this.#rollbackChain], finalized: this.#finalized }]
        : []

    // CN-40…CN-44: recovery removes anything the cursor does not cover, whatever the class's
    // crash window let through.
    const bound = this.#current?.number ?? -1
    this.#data = this.#data.filter((row) => row.block <= bound)
    this.#buffer = this.#buffer.filter((row) => row.block <= bound)

    this.#assertNoRowsAboveCursor()
    this.wellformedCheck()
  }

  /** T-BATCH — the batch transition, per the normative pseudocode. */
  batch(blocks: Cursor[], head: { finalized?: Cursor; latest?: { number: number } } = {}): void {
    this.#requireWellFormedBatch(blocks)

    // INV-12: the floor only ever advances, whatever the portal reports.
    if (head.finalized && (!this.#finalized || head.finalized.number > this.#finalized.number)) {
      this.#finalized = head.finalized
    }

    const floor = this.#finalized?.number ?? -1
    // INV-1: the rollback chain is exactly the processed blocks still above the floor.
    this.#rollbackChain = [...this.#rollbackChain, ...blocks].filter((b) => b.number > floor)

    const rows = blocks.flatMap((block) => this.#transform(block))

    let released: OracleRow[]
    if (DEFERRED.has(this.#durability)) {
      this.#buffer = [...this.#buffer, ...rows]
      released = this.#buffer.filter((row) => row.block <= floor)
      this.#buffer = this.#buffer.filter((row) => row.block > floor)
    } else {
      released = rows
    }

    this.#data = [...this.#data, ...released]
    this.#current = blocks.at(-1)
    this.#advanceCoverage(released)
    this.#history.push({ rollbackChain: [...this.#rollbackChain], finalized: this.#finalized })

    this.wellformedCheck()
  }

  /**
   * T-FORK — narrow the canonical window against the rollback chain, newest first, and rewind to
   * the ancestor both sides agree on (WP-42).
   */
  fork(canonical: Cursor[]): Cursor {
    if (!canonical.length) {
      throw new OracleError(ORACLE_ERRORS.EMPTY_CANONICAL, 'fork signalled with an empty canonical chain (WP-41)')
    }

    const top = Math.max(...canonical.map((b) => b.number))
    if (this.#current && top < this.#current.number) {
      throw new OracleError(
        ORACLE_ERRORS.CANONICAL_BELOW_CURSOR,
        `canonical head ${top} is below the committed cursor ${this.#current.number} (RP-43)`,
      )
    }

    const ancestor = this.#searchAncestor(canonical)
    if (!ancestor) {
      throw new OracleError(ORACLE_ERRORS.NO_ANCESTOR, 'no common ancestor between rollback chain and canonical chain')
    }

    this.#data = this.#data.filter((row) => row.block <= ancestor.number)
    this.#buffer = this.#buffer.filter((row) => row.block <= ancestor.number)
    this.#current = ancestor
    this.#rollbackChain = this.#rollbackChain.filter((b) => b.number <= ancestor.number)
    // INV-13/INV-14: the floor is never rewound by a fork.
    this.#history.push({ rollbackChain: [...this.#rollbackChain], finalized: this.#finalized })

    this.wellformedCheck()

    return ancestor
  }

  /**
   * WP-42: walk the persisted records newest → oldest, each record's chain descending, narrowing
   * the canonical window past every cursor visited.
   */
  #searchAncestor(canonical: Cursor[]): Cursor | undefined {
    let window = [...canonical]

    for (const record of [...this.#history].reverse()) {
      if (!record.rollbackChain.length) {
        continue
      }

      for (const visited of [...record.rollbackChain].sort((a, b) => b.number - a.number)) {
        const match = window.find((w) => w.hash === visited.hash)
        if (match) {
          return match
        }

        if (!window.length) {
          if (record.finalized && visited.number < record.finalized.number) {
            throw new OracleError(
              ORACLE_ERRORS.FINALITY_CONFLICT,
              `fork would rewind to ${visited.number}, below the finalized floor ${record.finalized.number} (WP-44)`,
            )
          }
          // Below the exhausted window: a deep fork, restart from here.
          return visited
        }

        window = window.filter((w) => w.number < visited.number)
      }

      // Floor fallback: the last canonical block standing is the floor itself.
      if (record.finalized && window.length === 1 && window[0].hash === record.finalized.hash) {
        return record.finalized
      }
    }

    return undefined
  }

  /** The same taxonomy the SUT's state read exposes. */
  readState(): OracleState {
    return {
      current: this.#current,
      finalized: this.#finalized,
      rollbackChain: [...this.#rollbackChain],
    }
  }

  /** Asserts INV-1…INV-5 after every transition. */
  wellformedCheck(): void {
    const floor = this.#finalized?.number
    const cursor = this.#current?.number

    // INV-1 — rollback chain well-formedness.
    let previous = -Infinity
    for (const entry of this.#rollbackChain) {
      if (entry.number <= previous) {
        throw new OracleError(
          ORACLE_ERRORS.INVARIANT,
          `INV-1: rollback chain is not strictly increasing at ${entry.number}`,
        )
      }
      if (!entry.hash) {
        throw new OracleError(ORACLE_ERRORS.INVARIANT, `INV-1: rollback chain entry ${entry.number} has no hash`)
      }
      if (floor !== undefined && entry.number <= floor) {
        throw new OracleError(
          ORACLE_ERRORS.INVARIANT,
          `INV-1: rollback chain entry ${entry.number} is at or below the floor ${floor}`,
        )
      }
      if (cursor !== undefined && entry.number > cursor) {
        throw new OracleError(
          ORACLE_ERRORS.INVARIANT,
          `INV-1: rollback chain entry ${entry.number} is above the cursor ${cursor}`,
        )
      }
      previous = entry.number
    }

    // INV-3 — attribution, including the class visibility rule (CN-20…CN-24).
    for (const row of this.#data) {
      if (cursor !== undefined && row.block > cursor) {
        throw new OracleError(ORACLE_ERRORS.INVARIANT, `INV-3: row at block ${row.block} is above the cursor ${cursor}`)
      }
      if (
        this.#range &&
        (row.block < this.#range.from || (this.#range.to !== undefined && row.block > this.#range.to))
      ) {
        throw new OracleError(
          ORACLE_ERRORS.INVARIANT,
          `INV-3: row at block ${row.block} falls outside the configured range`,
        )
      }
      if (DEFERRED.has(this.#durability) && floor !== undefined && row.block > floor) {
        throw new OracleError(
          ORACLE_ERRORS.INVARIANT,
          `INV-3: deferred sink made block ${row.block} visible above the floor ${floor}`,
        )
      }
    }

    // INV-5 — no state record refers above the newest committed data.
    const dataBound = this.#data.reduce((max, row) => Math.max(max, row.block), -Infinity)
    if (DEFERRED.has(this.#durability) && cursor !== undefined && dataBound > cursor) {
      throw new OracleError(
        ORACLE_ERRORS.INVARIANT,
        `INV-5: committed data reaches ${dataBound}, above the cursor ${cursor}`,
      )
    }
  }

  #requireWellFormedBatch(blocks: Cursor[]): void {
    if (!blocks.length) {
      throw new OracleError(ORACLE_ERRORS.NOT_LINKED, 'INV-20: empty batch')
    }

    // INV-20 — strictly ascending.
    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].number <= blocks[i - 1].number) {
        throw new OracleError(
          ORACLE_ERRORS.NOT_ASCENDING,
          `INV-20: batch is not strictly ascending at ${blocks[i - 1].number} → ${blocks[i].number}`,
        )
      }
    }

    // INV-20 — linkage: the batch continues where the cursor left off.
    const expected = this.#current ? this.#current.number + 1 : this.#range?.from
    if (expected !== undefined && blocks[0].number !== expected) {
      throw new OracleError(
        ORACLE_ERRORS.NOT_LINKED,
        `INV-20: batch starts at ${blocks[0].number}, expected ${expected}`,
      )
    }

    if (this.#range?.to !== undefined && blocks.at(-1)!.number > this.#range.to) {
      throw new OracleError(
        ORACLE_ERRORS.OUT_OF_RANGE,
        `INV-24: batch reaches ${blocks.at(-1)!.number}, above the configured end ${this.#range.to}`,
      )
    }
  }

  #assertNoRowsAboveCursor(): void {
    const bound = this.#current?.number ?? -1
    const stray = this.#data.find((row) => row.block > bound)
    if (stray) {
      throw new OracleError(
        ORACLE_ERRORS.ROWS_ABOVE_CURSOR,
        `INV-42: recovery left a row at block ${stray.block} above the cursor ${bound}`,
      )
    }
  }

  /** `V` in the DEF tuple: next window start per table (INV-4). */
  #advanceCoverage(released: OracleRow[]): void {
    for (const row of released) {
      const next = (this.#coverage[row.table] ?? this.#range?.from ?? 0) as number
      if (row.block >= next) {
        this.#coverage[row.table] = row.block + 1
      }
    }
  }
}
