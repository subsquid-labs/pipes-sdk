import { toCamelCase } from 'drizzle-orm/casing'

import { ContractMetadata, RawAbiEvent } from '~/services/sqd-abi.js'
import { areContractsCompatible } from '~/utils/event-signature.js'

export interface DecoderGroup {
  decoderId: string
  contracts: ContractMetadata[]
  events: RawAbiEvent[]
}

export interface DecoderGrouping {
  shared: boolean
  groups: DecoderGroup[]
}

export function groupContractsForDecoders(contracts: ContractMetadata[]): DecoderGrouping {
  const nonEmpty = contracts.filter((c) => c.contractEvents.length > 0)

  if (nonEmpty.length === 0) {
    return { shared: false, groups: [] }
  }

  // Single contract: keep existing behavior (contract prefix, single decoder)
  if (nonEmpty.length === 1) {
    return {
      shared: false,
      groups: [{ decoderId: 'custom', contracts: nonEmpty, events: nonEmpty[0].contractEvents }],
    }
  }

  // Multiple contracts, all share identical event signatures
  if (areContractsCompatible(nonEmpty)) {
    return {
      shared: true,
      groups: [{ decoderId: 'custom', contracts: nonEmpty, events: nonEmpty[0].contractEvents }],
    }
  }

  // Contracts differ: one decoder per contract
  return {
    shared: false,
    groups: nonEmpty.map((c) => {
      const camelName = toCamelCase(c.contractName)
      const decoderId = `custom${camelName.charAt(0).toUpperCase()}${camelName.slice(1)}`
      return { decoderId, contracts: [c], events: c.contractEvents }
    }),
  }
}
