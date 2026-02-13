import { ContractMetadata, RawAbiEvent } from '~/services/sqd-abi.js'

export function getEventSignature(event: RawAbiEvent): string {
  return `${event.name}(${event.inputs.map((i) => i.type).join(',')})`
}

function buildSignatureSet(contract: ContractMetadata): string {
  return contract.contractEvents
    .map(getEventSignature)
    .sort()
    .join('|')
}

export function areContractsCompatible(contracts: ContractMetadata[]): boolean {
  if (contracts.length <= 1) return true

  const first = buildSignatureSet(contracts[0])
  return contracts.slice(1).every((c) => buildSignatureSet(c) === first)
}
