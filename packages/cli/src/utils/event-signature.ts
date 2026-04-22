import { createHash } from 'node:crypto'

import { ContractMetadata, RawAbiEvent } from '~/services/sqd-abi.js'

export function getEventSignature(event: RawAbiEvent): string {
  return `${event.name}(${event.inputs.map((i) => i.type).join(',')})`
}

/**
 * Returns a short, stable suffix for an event derived from its full signature.
 * Used to disambiguate overloaded events that share a name but differ in input types.
 */
export function getEventSuffix(event: RawAbiEvent): string {
  return createHash('sha256').update(getEventSignature(event)).digest('hex').slice(0, 4)
}

function buildSignatureSet(contract: ContractMetadata): string {
  return contract.contractEvents.map(getEventSignature).sort().join('|')
}

export function areContractsCompatible(contracts: ContractMetadata[]): boolean {
  if (contracts.length <= 1) return true

  const first = buildSignatureSet(contracts[0])
  return contracts.slice(1).every((c) => buildSignatureSet(c) === first)
}
