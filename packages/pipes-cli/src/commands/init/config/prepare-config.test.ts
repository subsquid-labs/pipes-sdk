import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Config, NetworkType } from '~/types/init.js'

import { getTemplate } from '../templates/registry.js'
import { prepareConfig } from './prepare-config.js'

const transferEvent = {
  name: 'Transfer',
  type: 'event',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
}

const approvalEvent = {
  name: 'Approval',
  type: 'event',
  inputs: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
}

function configWithContracts(
  contracts: Array<{ contractAddress: string; contractName: string; [key: string]: unknown }>,
): Config<NetworkType> {
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

  describe('duplicate-address merging', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('collapses identical addresses with identical events into one entry', async () => {
      const contracts = [
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'WETH',
          contractEvents: [transferEvent],
          range: { from: '4719568' },
        },
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'WETH',
          contractEvents: [transferEvent],
          range: { from: '4719568' },
        },
      ]
      const config = configWithContracts(contracts)
      await prepareConfig(config, { resolveContracts: vi.fn(async () => {}) })

      const merged = (config.templates[0]!.params as { contracts: typeof contracts }).contracts
      expect(merged).toHaveLength(1)
      expect(merged[0]!.contractEvents).toHaveLength(1)
      expect(warnSpy).toHaveBeenCalledOnce()
    })

    it('unions contractEvents when duplicate addresses have disjoint event sets', async () => {
      const contracts = [
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'WETH',
          contractEvents: [transferEvent],
          range: { from: '4719568' },
        },
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'WETH2',
          contractEvents: [approvalEvent],
          range: { from: '4719568' },
        },
      ]
      const config = configWithContracts(contracts)
      await prepareConfig(config, { resolveContracts: vi.fn(async () => {}) })

      const merged = (config.templates[0]!.params as { contracts: typeof contracts }).contracts
      expect(merged).toHaveLength(1)
      expect(merged[0]!.contractName).toBe('WETH')
      expect(merged[0]!.contractEvents.map((e) => e.name).sort()).toEqual(['Approval', 'Transfer'])
    })

    it('dedups overlapping events by signature across duplicate addresses', async () => {
      const contracts = [
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'WETH',
          contractEvents: [transferEvent, approvalEvent],
          range: { from: '4719568' },
        },
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'WETH2',
          contractEvents: [approvalEvent],
          range: { from: '4719568' },
        },
      ]
      const config = configWithContracts(contracts)
      await prepareConfig(config, { resolveContracts: vi.fn(async () => {}) })

      const merged = (config.templates[0]!.params as { contracts: typeof contracts }).contracts
      expect(merged).toHaveLength(1)
      expect(merged[0]!.contractEvents).toHaveLength(2)
    })

    it('keeps the oldest numeric range when merging duplicate addresses', async () => {
      const contracts = [
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'WETH',
          contractEvents: [transferEvent],
          range: { from: '20000000' },
        },
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'WETH2',
          contractEvents: [transferEvent],
          range: { from: '4719568' },
        },
      ]
      const config = configWithContracts(contracts)
      await prepareConfig(config, { resolveContracts: vi.fn(async () => {}) })

      const merged = (config.templates[0]!.params as { contracts: typeof contracts }).contracts
      expect(merged[0]!.range.from).toBe('4719568')
    })

    it('treats case-insensitive addresses as duplicates', async () => {
      const contracts = [
        {
          contractAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          contractName: 'WETH',
          contractEvents: [transferEvent],
          range: { from: 'latest' },
        },
        {
          contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          contractName: 'weth',
          contractEvents: [transferEvent],
          range: { from: 'latest' },
        },
      ]
      const config = configWithContracts(contracts)
      await prepareConfig(config, { resolveContracts: vi.fn(async () => {}) })

      const merged = (config.templates[0]!.params as { contracts: typeof contracts }).contracts
      expect(merged).toHaveLength(1)
    })
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
