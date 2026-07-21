import { toCamelCase, toSnakeCase } from 'drizzle-orm/casing'

import { RawAbiEvent } from '~/services/sqd-abi.js'

import { referenceAddress } from '../../../../contract-params.js'
import { CustomTemplateParams } from '../template.config.js'

type Contract = CustomTemplateParams['contracts'][number]

/**
 * A program's identity is its reference-deployment address, not its display name: two
 * configured names can normalise to the same identifier ("Foo Bar" / "foo_bar"), and
 * collapsing them would merge unrelated programs into one decoder, one typegen import
 * and one table.
 */
export function programIdentifiers(programs: { contractName: string; typegenAddress: string }[]): Map<string, string> {
  const identifiers = new Map<string, string>()
  const used = new Set<string>()
  for (const p of programs) {
    if (identifiers.has(p.typegenAddress)) {
      continue
    }

    identifiers.set(p.typegenAddress, uniquify(toCamelCase(p.contractName), used, ''))
  }

  return identifiers
}

export interface ProgramTable {
  typegenAddress: string
  /** camelCase program identifier — typegen import alias and decoder-id suffix. */
  program: string
  instruction: RawAbiEvent
  table: string
}

/**
 * The insert surface, derived once. Tables are program-level: deployments and the
 * per-range decoders of one program share them. All three renderers (transformer
 * insert targets, Drizzle schema, ClickHouse DDL) read the names from here — deriving
 * them independently is how they drifted apart, emitting a schema whose table names
 * the pipeline never writes to.
 */
export function programTables(contracts: Contract[]): ProgramTable[] {
  const identifiers = programIdentifiers(
    contracts.map((c) => ({ contractName: c.contractName, typegenAddress: referenceAddress(c) })),
  )
  const used = new Set<string>()
  const seen = new Set<string>()

  return contracts.flatMap((c) => {
    const typegenAddress = referenceAddress(c)
    if (seen.has(typegenAddress)) {
      return []
    }

    seen.add(typegenAddress)

    return c.contractEvents.map((instruction) => ({
      typegenAddress,
      program: identifiers.get(typegenAddress)!,
      instruction,
      // Snake-cased from the joined display name, as the generated DDL always has;
      // re-casing the camelCase identifier instead mangles digits ("Raydium AMM v4"
      // → raydium_ammv_4 rather than raydium_amm_v4).
      table: uniquify(toSnakeCase(`${c.contractName}_${instruction.name}`), used, '_'),
    }))
  })
}

function uniquify(base: string, used: Set<string>, separator: string): string {
  let name = base
  for (let n = 2; used.has(name); n++) {
    name = `${base}${separator}${n}`
  }
  used.add(name)

  return name
}
