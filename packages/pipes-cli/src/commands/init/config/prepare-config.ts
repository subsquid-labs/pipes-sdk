import type { Config, NetworkType } from '~/types/init.js'
import { getEventSignature } from '~/utils/event-signature.js'
import { oldestRange } from '~/utils/range.js'
import { resolveDuplicateContractNames as realResolver } from '~/utils/resolve-duplicate-contracts.js'

type RawAbiEventShape = { name: string; type: string; inputs: Array<{ name: string; type: string }> }
type RangeShape = { from: string; to?: string }
type DeploymentShape = { address: string; range?: RangeShape }
type ContractShape = {
  contractName: string
  contractEvents?: RawAbiEventShape[]
  deployments: DeploymentShape[]
}

export type PrepareConfigOptions = {
  resolveContracts?: (contracts: { contractAddress: string; contractName: string }[]) => Promise<void>
}

/**
 * Normalize a config before it is handed to InitHandler. Runs for every path
 * (interactive, --config, --config-id), so it is the single place that merges
 * duplicate deployments/contracts and resolves duplicate contract names.
 */
export async function prepareConfig(config: Config<NetworkType>, options: PrepareConfigOptions = {}): Promise<void> {
  const resolve = options.resolveContracts ?? realResolver

  for (const { params } of config.templates) {
    const contracts = (params as { contracts?: ContractShape[] } | undefined)?.contracts
    if (Array.isArray(contracts)) {
      for (const contract of contracts) {
        mergeDuplicateDeployments(contract.deployments, contract.contractName)
      }
      mergeContractsSharingDeployments(contracts)
      await resolveNames(contracts, resolve)
    }

    // Templates with a fixed ABI (e.g. ERC-20 transfers) carry a bare deployments list.
    const deployments = (params as { deployments?: DeploymentShape[] } | undefined)?.deployments
    if (Array.isArray(deployments) && !Array.isArray(contracts)) {
      mergeDuplicateDeployments(deployments)
    }
  }
}

/** Same address listed twice within one contract: keep the first, widen to the oldest range. */
function mergeDuplicateDeployments(deployments: DeploymentShape[], contractName?: string): void {
  const firstByAddress = new Map<string, DeploymentShape>()
  const toRemove: number[] = []

  deployments.forEach((deployment, i) => {
    const first = firstByAddress.get(deployment.address.toLowerCase())
    if (!first) {
      firstByAddress.set(deployment.address.toLowerCase(), deployment)
      return
    }

    // Prefer whichever range exists; an absent range means 'latest', so any explicit
    // range on the duplicate is the older (wider) choice.
    first.range =
      first.range && deployment.range ? oldestRange(first.range, deployment.range) : (first.range ?? deployment.range)
    toRemove.push(i)
    console.warn(
      `Deployment ${deployment.address}${contractName ? ` of ${contractName}` : ''} is listed more than once; merged.`,
    )
  })

  for (let i = toRemove.length - 1; i >= 0; i--) deployments.splice(toRemove[i]!, 1)
}

/**
 * Two contract entries sharing a deployment address are the same on-chain contract:
 * merge them (union of events, union of deployments) into the first entry.
 *
 * A merge can bridge two previously-distinct contracts (an entry listing addresses
 * owned by different owners), so passes repeat until a fixpoint — a single pass
 * would leave the earlier owner sharing an address with the merge survivor.
 */
function mergeContractsSharingDeployments(contracts: ContractShape[]): void {
  let changed = true
  while (changed) {
    changed = mergeContractsOnce(contracts)
  }
}

function mergeContractsOnce(contracts: ContractShape[]): boolean {
  const ownerByAddress = new Map<string, ContractShape>()
  const toRemove: number[] = []

  contracts.forEach((contract, i) => {
    const owner = contract.deployments.map((d) => ownerByAddress.get(d.address.toLowerCase())).find(Boolean)

    if (!owner) {
      for (const d of contract.deployments) ownerByAddress.set(d.address.toLowerCase(), contract)
      return
    }

    if (Array.isArray(owner.contractEvents) && Array.isArray(contract.contractEvents)) {
      const seen = new Set(owner.contractEvents.map(getEventSignature))
      for (const event of contract.contractEvents) {
        if (!seen.has(getEventSignature(event))) {
          owner.contractEvents.push(event)
          seen.add(getEventSignature(event))
        }
      }
    }

    const ownedAddresses = new Set(owner.deployments.map((d) => d.address.toLowerCase()))
    for (const deployment of contract.deployments) {
      if (ownedAddresses.has(deployment.address.toLowerCase())) {
        const existing = owner.deployments.find((d) => d.address.toLowerCase() === deployment.address.toLowerCase())!
        existing.range =
          existing.range && deployment.range
            ? oldestRange(existing.range, deployment.range)
            : (existing.range ?? deployment.range)
      } else {
        owner.deployments.push(deployment)
        ownerByAddress.set(deployment.address.toLowerCase(), owner)
      }
    }

    toRemove.push(i)
    console.warn(
      `Contract "${contract.contractName}" shares a deployment with "${owner.contractName}"; merged into the latter.`,
    )
  })

  for (let i = toRemove.length - 1; i >= 0; i--) contracts.splice(toRemove[i]!, 1)

  return toRemove.length > 0
}

/** Duplicate contract names are resolved once, here — at the contract level, using the reference address for display. */
async function resolveNames(
  contracts: ContractShape[],
  resolve: NonNullable<PrepareConfigOptions['resolveContracts']>,
) {
  const views = contracts.map((contract) => ({
    contractAddress: contract.deployments[0]?.address ?? '',
    contractName: contract.contractName,
  }))

  await resolve(views)

  views.forEach((view, i) => {
    contracts[i]!.contractName = view.contractName
  })
}
