import { describe, expect, it, vi } from 'vitest'

import type { Config, NetworkType } from '~/types/init.js'

import { getTemplate } from '../templates/registry.js'
import { prepareConfig } from './prepare-config.js'

function configWithContracts(contracts: Array<{ contractAddress: string; contractName: string }>): Config<NetworkType> {
  const custom = getTemplate('evm', 'custom')!
  return {
    projectFolder: '/tmp/proj',
    networkType: 'evm',
    network: 'ethereum-mainnet',
    sink: 'clickhouse',
    packageManager: 'pnpm',
    templates: [
      {
        template: custom,
        params: { contracts },
      },
    ],
  }
}

describe('prepareConfig', () => {
  it('invokes the resolver for templates whose params contain contracts', async () => {
    const config = configWithContracts([
      { contractAddress: '0x1111', contractName: 'TokenA' },
      { contractAddress: '0x2222', contractName: 'TokenB' },
    ])
    const resolveContracts = vi.fn(async () => {})

    await prepareConfig(config, { resolveContracts })

    expect(resolveContracts).toHaveBeenCalledTimes(1)
    expect(resolveContracts).toHaveBeenCalledWith((config.templates[0]!.params as { contracts: unknown }).contracts)
  })

  it('lets the resolver mutate contract names to make them unique', async () => {
    const config = configWithContracts([
      { contractAddress: '0x1111aaaa', contractName: 'Token' },
      { contractAddress: '0x2222bbbb', contractName: 'Token' },
    ])
    const resolveContracts = vi.fn(async (contracts: Array<{ contractAddress: string; contractName: string }>) => {
      const seen = new Set<string>()
      for (const c of contracts) {
        if (seen.has(c.contractName)) {
          c.contractName = `${c.contractName}_${c.contractAddress.slice(0, 6)}`
        }
        seen.add(c.contractName)
      }
    })

    await prepareConfig(config, { resolveContracts })

    const renamed = (
      config.templates[0]!.params as {
        contracts: Array<{ contractName: string }>
      }
    ).contracts.map((c) => c.contractName)
    expect(new Set(renamed).size).toBe(renamed.length)
  })

  it('skips templates whose params do not contain a contracts array', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const config: Config<NetworkType> = {
      projectFolder: '/tmp/proj',
      networkType: 'evm',
      network: 'ethereum-mainnet',
      sink: 'clickhouse',
      packageManager: 'pnpm',
      templates: [
        {
          template: erc20,
          params: { contractAddresses: [], range: { from: '1' } },
        },
      ],
    }
    const resolveContracts = vi.fn(async () => {})

    await prepareConfig(config, { resolveContracts })

    expect(resolveContracts).not.toHaveBeenCalled()
  })
})
