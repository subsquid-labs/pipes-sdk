import { type AbiEvent, event, keccak256 } from '@subsquid/evm-abi'
import type { Struct } from '@subsquid/evm-codec'

import type { EvmQueryBuilder } from '../../../../../../packages/pipes/src/evm/index.js'
import type { ParquetColumn } from '../../../../../../packages/pipes/src/targets/parquet/index.js'
import type { BenchRange } from '../../types.js'

export function dec(v: bigint | number | null | undefined): string | null {
  if (v === null || v === undefined) {
    return null
  }

  return v.toString()
}

export type DualRep = { string_value: string | null; bignumeric_value: string | null }

/** Polygon dual-representation numeric: one scalar mirrored into both record fields. */
export function dualRep(v: bigint | number | null | undefined): DualRep | null {
  if (v === null || v === undefined) {
    return null
  }
  const value = v.toString()

  return { string_value: value, bignumeric_value: value }
}

export function dualRepColumn(): ParquetColumn {
  return {
    type: 'STRUCT',
    optional: true,
    fields: {
      string_value: { type: 'UTF8', optional: true },
      bignumeric_value: { type: 'UTF8', optional: true },
    },
  }
}

export function bigintToHex(v: bigint | number | null | undefined): string | null {
  if (v === null || v === undefined) {
    return null
  }

  return `0x${BigInt(v).toString(16)}`
}

/** JSON.stringify rendering bigints as decimal strings (gfs codec behavior for JSON columns). */
export function jsonStringify(v: unknown): string {
  const json = JSON.stringify(v, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))
  if (json === undefined) {
    throw new TypeError('Unsupported top-level value for JSON serialization')
  }

  return json
}

/**
 * The EVM builder has no public includeAllBlocks setter (unlike bitcoin's) — push the raw
 * data request through the public getRequests() accessor; build() merges the flag. Projecting
 * that accessor accepts every invariant EvmQueryBuilder field selection without an any escape hatch.
 */
export function includeAllBlocks(query: Pick<EvmQueryBuilder, 'getRequests'>, range: BenchRange): void {
  query.getRequests().push({ range, request: { includeAllBlocks: true } })
}

/** Define an ABI event computing topic0 from the signature — no hand-written hashes. */
export function sigEvent<const T extends Struct>(signature: string, args: T): AbiEvent<T> {
  const topic = `0x${Buffer.from(keccak256(signature)).toString('hex')}`

  return event(topic, signature, args)
}
