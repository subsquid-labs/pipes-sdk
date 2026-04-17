import type { Config, NetworkType } from '~/types/init.js'
import { getEventSignature } from '~/utils/event-signature.js'
import { resolveDuplicateContractNames as realResolver } from '~/utils/resolve-duplicate-contracts.js'

type Contract = { contractAddress: string; contractName: string }

type RawAbiEventShape = { name: string; type: string; inputs: Array<{ name: string; type: string }> }
type RangeShape = { from: string; to?: string }
type ContractWithOptionalShape = Contract & {
  contractEvents?: RawAbiEventShape[]
  range?: RangeShape
}

export type PrepareConfigOptions = {
  resolveContracts?: (contracts: Contract[]) => Promise<void>
}

/**
 * Normalize a config before it is handed to InitHandler. Merges duplicate contract
 * addresses (union of events, oldest range) then resolves duplicate contract names.
 */
export async function prepareConfig(config: Config<NetworkType>, options: PrepareConfigOptions = {}): Promise<void> {
  const resolve = options.resolveContracts ?? realResolver

  for (const { params } of config.templates) {
    const contracts = (params as { contracts?: ContractWithOptionalShape[] } | undefined)?.contracts
    if (!contracts || !Array.isArray(contracts)) continue
    mergeDuplicateAddresses(contracts)
    await resolve(contracts)
  }
}

function mergeDuplicateAddresses(contracts: ContractWithOptionalShape[]): void {
  const firstIndexByAddress = new Map<string, number>()
  const toRemove: number[] = []

  for (let i = 0; i < contracts.length; i++) {
    const current = contracts[i]!
    const addr = current.contractAddress.toLowerCase()
    const firstIdx = firstIndexByAddress.get(addr)

    if (firstIdx === undefined) {
      firstIndexByAddress.set(addr, i)
      continue
    }

    const first = contracts[firstIdx]!
    if (Array.isArray(first.contractEvents) && Array.isArray(current.contractEvents)) {
      const seen = new Set(first.contractEvents.map(getEventSignature))
      for (const event of current.contractEvents) {
        const sig = getEventSignature(event)
        if (!seen.has(sig)) {
          first.contractEvents.push(event)
          seen.add(sig)
        }
      }
    }
    if (current.range && first.range) {
      first.range = oldestRange(first.range, current.range)
    }

    toRemove.push(i)
    console.warn(
      `Contract ${current.contractAddress} is listed more than once; merged into first occurrence "${first.contractName}".`,
    )
  }

  for (let i = toRemove.length - 1; i >= 0; i--) {
    contracts.splice(toRemove[i]!, 1)
  }
}

function oldestRange(a: RangeShape, b: RangeShape): RangeShape {
  const na = Number(a.from)
  const nb = Number(b.from)
  if (isNaN(nb)) return a
  if (isNaN(na)) return b
  return nb < na ? b : a
}
