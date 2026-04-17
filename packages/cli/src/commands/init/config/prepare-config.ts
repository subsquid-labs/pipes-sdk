import type { Config, NetworkType } from '~/types/init.js'
import { resolveDuplicateContractNames as realResolver } from '~/utils/resolve-duplicate-contracts.js'

type Contract = { contractAddress: string; contractName: string }

export type PrepareConfigOptions = {
  resolveContracts?: (contracts: Contract[]) => Promise<void>
}

/**
 * Normalize a config before it is handed to InitHandler. Today this resolves duplicate
 * contract names across templates that accept free-form contract lists.
 */
export async function prepareConfig(config: Config<NetworkType>, options: PrepareConfigOptions = {}): Promise<void> {
  const resolve = options.resolveContracts ?? realResolver

  for (const { params } of config.templates) {
    const contracts = (params as { contracts?: Contract[] } | undefined)?.contracts
    if (!contracts || !Array.isArray(contracts)) continue
    await resolve(contracts)
  }
}
