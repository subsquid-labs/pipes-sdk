import { describe, expect, it, vi } from 'vitest'

import { erc20TransfersTemplate } from './template.config.js'

const ctx = {
  network: 'ethereum-mainnet',
  projectPath: '/tmp/project',
  networkType: 'evm' as const,
}

describe('erc20TransfersTemplate.render', () => {
  it('renders transformer, schemas, and decoderIds', () => {
    const params = {
      contractAddresses: ['0xaaa'],
      range: { from: '100' },
    }
    const artifacts = erc20TransfersTemplate.render(params, ctx)

    expect(artifacts.transformer).toContain("'0xaaa'")
    expect(artifacts.transformer).toContain("range: { from: '100' }")
    expect(artifacts.decoderIds).toEqual(['erc20Transfers'])
    expect(artifacts.postgresSchema).toContain('erc20TransfersTable')
    expect(artifacts.clickhouseTable).toMatch(/CREATE TABLE/i)
  })

  it('has correct identity metadata', () => {
    expect(erc20TransfersTemplate.id).toBe('erc20Transfers')
    expect(erc20TransfersTemplate.name).toBe('ERC-20 Transfers')
    expect(erc20TransfersTemplate.networkType).toBe('evm')
  })
})

describe('erc20TransfersTemplate.prompt', () => {
  it('collects contract addresses and block range', async () => {
    const promptCtx = {
      text: vi.fn(async (_msg: string, def?: string) => def ?? '0xabc'),
      checkbox: vi.fn(),
      blockRange: vi.fn(async () => ({ from: 500 })),
      abiService: {} as any,
      network: 'ethereum-mainnet',
    }

    const params = await erc20TransfersTemplate.prompt!(promptCtx)

    expect(params.contractAddresses).toEqual(['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'])
    expect(params.range).toEqual({ from: 500 })
  })
})
