import type { Cursor, OracleState } from './reference-model.js'

/** A structural rule broken by an emission or a persisted state. */
export type Violation = {
  /** Which validator fired. */
  validator: string
  /** The spec property it enforces. */
  property: string
  message: string
}

/** Anything attributed to a block — the only thing these validators know about a row. */
export type Attributed = {
  block: number
}

/** A published unit (a file, a partition) and the window it claims to cover. */
export type PublishedUnit = {
  name: string
  from: number
  to: number
  rows: Attributed[]
}

/** One batch as delivered, with the cursor that preceded it. */
export type DeliveredBatch = {
  blocks: { number: number }[]
  cursorBefore?: number
}

/**
 * Kind-agnostic structural validators.
 *
 * They hold of any emission or state without domain knowledge, so they stay on for every scenario
 * rather than being written per sink. Nothing here inspects row *content* — that is the oracle's
 * job; these only check shape, ordering, attribution and watermark coherence.
 */

/** Decodable: every item parses per its format. */
export function validateDecodable<T>(items: readonly T[], decode: (item: T) => unknown): Violation[] {
  const violations: Violation[] = []

  items.forEach((item, index) => {
    try {
      decode(item)
    } catch (error) {
      violations.push({
        validator: 'decodable',
        property: 'INV-5',
        message: `item ${index} does not parse: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  })

  return violations
}

/** Ordered: attribution ascends. Duplicates are a violation — attribution is unique (INV-3). */
export function validateOrdered(
  rows: readonly Attributed[],
  { strict = true }: { strict?: boolean } = {},
): Violation[] {
  const violations: Violation[] = []

  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1].block
    const current = rows[i].block
    if (strict ? current <= previous : current < previous) {
      violations.push({
        validator: 'ordered',
        property: 'INV-20',
        message: `attribution does not ascend at index ${i}: ${previous} → ${current}`,
      })
    }
  }

  return violations
}

/** Linked: each batch starts exactly one block above the cursor it was requested from. */
export function validateLinked(batches: readonly DeliveredBatch[]): Violation[] {
  const violations: Violation[] = []

  batches.forEach((batch, index) => {
    if (batch.cursorBefore === undefined || !batch.blocks.length) {
      return
    }

    const expected = batch.cursorBefore + 1
    if (batch.blocks[0].number !== expected) {
      violations.push({
        validator: 'linked',
        property: 'INV-20',
        message: `batch ${index} starts at ${batch.blocks[0].number}, expected ${expected}`,
      })
    }
  })

  return violations
}

/** Items-belong-to-parent: every row sits inside the window its unit claims. */
export function validateItemsBelongToParent(units: readonly PublishedUnit[]): Violation[] {
  const violations: Violation[] = []

  for (const unit of units) {
    for (const row of unit.rows) {
      if (row.block < unit.from || row.block > unit.to) {
        violations.push({
          validator: 'items-belong-to-parent',
          property: 'INV-3',
          message: `unit '${unit.name}' claims [${unit.from}, ${unit.to}] but holds a row at ${row.block}`,
        })
      }
    }
  }

  return violations
}

/** In-range: attribution falls inside a configured range. */
export function validateInRange(
  rows: readonly Attributed[],
  ranges: readonly { from: number; to?: number }[],
): Violation[] {
  const violations: Violation[] = []
  if (!ranges.length) {
    return violations
  }

  for (const row of rows) {
    const covered = ranges.some((r) => row.block >= r.from && (r.to === undefined || row.block <= r.to))
    if (!covered) {
      violations.push({
        validator: 'in-range',
        property: 'INV-3',
        message: `row at block ${row.block} falls outside every configured range`,
      })
    }
  }

  return violations
}

/**
 * Watermark coherence: the rollback chain sits strictly above the floor and at or below the
 * cursor, and the cursor covers the committed data (INV-1, INV-5).
 */
export function validateWatermarks(state: OracleState, { dataBound }: { dataBound?: number } = {}): Violation[] {
  const violations: Violation[] = []
  const floor = state.finalized?.number
  const cursor = state.current?.number

  let previous = -Infinity
  for (const entry of state.rollbackChain) {
    if (entry.number <= previous) {
      violations.push({
        validator: 'watermark-coherence',
        property: 'INV-1',
        message: `rollback chain is not strictly increasing at ${entry.number}`,
      })
    }
    if (!entry.hash) {
      violations.push({
        validator: 'watermark-coherence',
        property: 'INV-1',
        message: `rollback chain entry ${entry.number} carries no hash`,
      })
    }
    if (floor !== undefined && entry.number <= floor) {
      violations.push({
        validator: 'watermark-coherence',
        property: 'INV-1',
        message: `rollback chain entry ${entry.number} is at or below the floor ${floor}`,
      })
    }
    if (cursor !== undefined && entry.number > cursor) {
      violations.push({
        validator: 'watermark-coherence',
        property: 'INV-1',
        message: `rollback chain entry ${entry.number} is above the cursor ${cursor}`,
      })
    }
    previous = entry.number
  }

  if (dataBound !== undefined && cursor !== undefined && dataBound > cursor) {
    violations.push({
      validator: 'watermark-coherence',
      property: 'INV-5',
      message: `committed data reaches ${dataBound}, above the cursor ${cursor}`,
    })
  }

  return violations
}

export type StructuralInput = {
  rows?: readonly Attributed[]
  units?: readonly PublishedUnit[]
  batches?: readonly DeliveredBatch[]
  state?: OracleState
  ranges?: readonly { from: number; to?: number }[]
  /** Highest block the committed data reaches, when known. */
  dataBound?: number
}

/** Runs every applicable validator over one observation. */
export function validateStructure(input: StructuralInput): Violation[] {
  const violations: Violation[] = []

  if (input.rows) {
    violations.push(...validateOrdered(input.rows))
    if (input.ranges) {
      violations.push(...validateInRange(input.rows, input.ranges))
    }
  }
  if (input.units) {
    violations.push(...validateItemsBelongToParent(input.units))
  }
  if (input.batches) {
    violations.push(...validateLinked(input.batches))
  }
  if (input.state) {
    violations.push(...validateWatermarks(input.state, { dataBound: input.dataBound }))
  }

  return violations
}

/** Throws with every violation listed, for use as a test assertion. */
export function assertStructure(input: StructuralInput): void {
  const violations = validateStructure(input)
  if (!violations.length) {
    return
  }

  throw new Error(
    `${violations.length} structural violation(s):\n` +
      violations.map((v) => `  [${v.validator} · ${v.property}] ${v.message}`).join('\n'),
  )
}

/** Convenience for the common case of checking a cursor list is a well-formed chain. */
export function isAscendingChain(cursors: readonly Cursor[]): boolean {
  return cursors.every((c, i) => i === 0 || c.number > cursors[i - 1].number)
}
