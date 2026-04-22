import { describe, expect, it, vi } from 'vitest'

import { customTemplate, getGrouping } from './template.config.js'

const ctx = {
  network: 'ethereum-mainnet',
  projectPath: '/tmp/project',
  networkType: 'evm' as const,
}

const weth = {
  contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  contractName: 'WETH9',
  contractEvents: [
    {
      name: 'Approval',
      type: 'event',
      inputs: [
        { name: 'src', type: 'address' },
        { name: 'guy', type: 'address' },
        { name: 'wad', type: 'uint256' },
      ],
    },
  ],
  range: { from: 'latest' },
}

describe('evm customTemplate', () => {
  it('has identity metadata', () => {
    expect(customTemplate.id).toBe('custom')
    expect(customTemplate.networkType).toBe('evm')
  })

  it('render() produces artifacts with decoder ids grouped by contract', () => {
    const artifacts = customTemplate.render({ contracts: [weth] }, ctx)
    expect(artifacts.transformer).toContain('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
    expect(artifacts.postgresSchema).toContain('weth9ApprovalTable')
    expect(artifacts.clickhouseTable.toLowerCase()).toContain('create table')
    expect(artifacts.decoderIds.length).toBeGreaterThan(0)
  })

  it('getGrouping() returns a stable reference on repeated calls for the same params', () => {
    const params = { contracts: [weth] }
    const first = getGrouping(params)
    const second = getGrouping(params)
    expect(second).toBe(first)
  })

  it('prompt() fetches contract metadata and selects events', async () => {
    const fetchedMeta = [
      {
        contractAddress: weth.contractAddress,
        contractName: 'WETH9',
        contractEvents: weth.contractEvents,
      },
    ]
    const abiService = {
      getContractData: vi.fn(async () => fetchedMeta),
    }
    const promptCtx = {
      text: vi.fn(async () => weth.contractAddress),
      checkbox: vi.fn(async (_msg: string, choices: Array<{ value: any }>) => [choices[0].value]),
      blockRange: vi.fn(async () => ({ from: 10 })),
      abiService: abiService as any,
      network: 'ethereum-mainnet',
    }

    const params = await customTemplate.prompt!(promptCtx)

    expect(abiService.getContractData).toHaveBeenCalledWith('evm', 'ethereum-mainnet', [weth.contractAddress])
    expect(params.contracts).toHaveLength(1)
    expect(params.contracts[0].contractAddress).toBe(weth.contractAddress)
    expect(params.contracts[0].contractEvents).toEqual([weth.contractEvents[0]])
    expect(params.contracts[0].range).toEqual({ from: 10 })
  })
})
