import { toCamelCase } from 'drizzle-orm/casing'

import { ContractMetadata, RawAbiEvent } from '~/services/sqd-abi.js'
import { BlockRange } from '~/utils/block-range-prompt.js'
import { areContractsCompatible } from '~/utils/event-signature.js'
import { oldestRange as pickOldestRange } from '~/utils/range.js'

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

  return ranges.reduce((oldest, r) => pickOldestRange(oldest, r))
}

export function areRangesCompatible(contracts: ContractWithRange[]): boolean {
  if (contracts.length <= 1) return true
  const [first, ...rest] = contracts
  const firstFrom = first.range?.from ?? 'latest'
  const firstTo = first.range?.to
  return rest.every((c) => (c.range?.from ?? 'latest') === firstFrom && c.range?.to === firstTo)
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

  // Multiple contracts, all share identical event signatures AND ranges.
  // Range compatibility matters because evmDecoder uses a single range for the
  // whole decoder — collapsing divergent ranges would silently widen the scan.
  if (areContractsCompatible(nonEmpty) && areRangesCompatible(nonEmpty)) {
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

  // Contracts differ (by events or by range): one decoder per contract
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
