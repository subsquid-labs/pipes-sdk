import { describe, expect, it, vi } from 'vitest'

import { customTemplate } from './template.config.js'

const ctx = {
  network: 'solana-mainnet',
  projectPath: '/tmp/project',
  networkType: 'svm' as const,
}

const whirlpool = {
  contractAddress: '0x0000000000000000000000000000000000000000',
  contractName: 'whirpool',
  contractEvents: [
    {
      name: 'Swap',
      type: 'event',
      inputs: [
        { name: 'amount0', type: 'i128' },
        { name: 'amount1', type: 'i128' },
      ],
    },
  ],
  range: { from: 'latest' },
}

describe('svm customTemplate', () => {
  it('identity metadata', () => {
    expect(customTemplate.id).toBe('custom')
    expect(customTemplate.networkType).toBe('svm')
  })

  it('render() produces artifacts for svm custom contract', () => {
    const artifacts = customTemplate.render({ contracts: [whirlpool] }, ctx)
    expect(artifacts.transformer).toContain('0x0000000000000000000000000000000000000000')
    expect(artifacts.decoderIds).toContain('custom')
  })

  it('prompt() fetches svm contract metadata', async () => {
    const fetchedMeta = [
      {
        contractAddress: whirlpool.contractAddress,
        contractName: whirlpool.contractName,
        contractEvents: whirlpool.contractEvents,
      },
    ]
    const abiService = {
      getContractData: vi.fn(async () => fetchedMeta),
    }
    const promptCtx = {
      text: vi.fn(async () => whirlpool.contractAddress),
      checkbox: vi.fn(async (_msg: string, choices: Array<{ value: any }>) => [choices[0].value]),
      blockRange: vi.fn(async () => ({ from: 0 })),
      abiService: abiService as any,
      network: 'solana-mainnet',
    }

    const params = await customTemplate.prompt!(promptCtx)

    expect(abiService.getContractData).toHaveBeenCalledWith('svm', 'solana-mainnet', [whirlpool.contractAddress])
    expect(params.contracts).toHaveLength(1)
    expect(params.contracts[0].contractEvents).toEqual([whirlpool.contractEvents[0]])
  })
})
