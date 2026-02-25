import { toCamelCase } from 'drizzle-orm/casing'

import { ContractMetadata, RawAbiEvent } from '~/services/sqd-abi.js'
import { BlockRange } from '~/utils/block-range-prompt.js'
import { areContractsCompatible } from '~/utils/event-signature.js'

export interface ContractWithRange extends ContractMetadata {
  range?: BlockRange
}

export interface DecoderGroup {
  decoderId: string
  contracts: ContractWithRange[]
  events: RawAbiEvent[]
  range: BlockRange
}

export interface DecoderGrouping {
  shared: boolean
  groups: DecoderGroup[]
}

function oldestRange(contracts: ContractWithRange[]): BlockRange {
  const ranges = contracts.map((c) => c.range).filter(Boolean) as BlockRange[]
  if (ranges.length === 0) return { from: 'latest' }

  // Pick the range with the smallest numeric `from`, or the first if non-numeric
  return ranges.reduce((oldest, r) => {
    const a = Number(oldest.from)
    const b = Number(r.from)
    if (isNaN(b)) return oldest
    if (isNaN(a)) return r
    return b < a ? r : oldest
  })
}

export function groupContractsForDecoders(contracts: ContractWithRange[]): DecoderGrouping {
  const nonEmpty = contracts.filter((c) => c.contractEvents.length > 0)

  if (nonEmpty.length === 0) {
    return { shared: false, groups: [] }
  }

  // Single contract: keep existing behavior (contract prefix, single decoder)
  if (nonEmpty.length === 1) {
    return {
      shared: false,
      groups: [
        {
          decoderId: 'custom',
          contracts: nonEmpty,
          events: nonEmpty[0].contractEvents,
          range: nonEmpty[0].range ?? { from: 'latest' },
        },
      ],
    }
  }

  // Multiple contracts, all share identical event signatures
  if (areContractsCompatible(nonEmpty)) {
    return {
      shared: true,
      groups: [
        {
          decoderId: 'custom',
          contracts: nonEmpty,
          events: nonEmpty[0].contractEvents,
          range: oldestRange(nonEmpty),
        },
      ],
    }
  }

  // Contracts differ: one decoder per contract
  return {
    shared: false,
    groups: nonEmpty.map((c) => {
      const camelName = toCamelCase(c.contractName)
      const decoderId = `custom${camelName.charAt(0).toUpperCase()}${camelName.slice(1)}`
      return {
        decoderId,
        contracts: [c],
        events: c.contractEvents,
        range: c.range ?? { from: 'latest' },
      }
    }),
  }
}
