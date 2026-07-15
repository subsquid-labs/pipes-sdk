import { describe, expect, it, vi } from 'vitest'

import { uniswapV3SwapsTemplate } from './template.config.js'

const ctx = {
  network: 'ethereum-mainnet',
  projectPath: '/tmp/project',
  networkType: 'evm' as const,
}

describe('uniswapV3SwapsTemplate', () => {
  it('has identity and copySrc metadata', () => {
    expect(uniswapV3SwapsTemplate.id).toBe('uniswapV3Swaps')
    expect(uniswapV3SwapsTemplate.name).toBe('Uniswap V3 Swaps')
    expect(uniswapV3SwapsTemplate.networkType).toBe('evm')
    expect(uniswapV3SwapsTemplate.copySrc).toBe('src')
  })

  it('render() substitutes factoryAddress and range', () => {
    const params = {
      factoryAddress: '0xfactory',
      range: { from: '1' },
    }
    const artifacts = uniswapV3SwapsTemplate.render(params, ctx)
    expect(artifacts.transformer).toContain("'0xfactory'")
    expect(artifacts.transformer).toContain("range: { from: '1' }")
    expect(artifacts.decoderIds).toEqual(['uniswapV3Swaps'])
  })

  it('prompt() collects factoryAddress and range via PromptContext', async () => {
    const promptCtx = {
      text: vi.fn(async (_msg: string, def?: string) => def ?? '0xdefault'),
      confirm: vi.fn(async () => false),
      select: vi.fn(),
      checkbox: vi.fn(),
      blockRange: vi.fn(async () => ({ from: '99' })),
      abiService: {} as any,
      network: 'ethereum-mainnet',
    }
    const params = await uniswapV3SwapsTemplate.prompt!(promptCtx)
    expect(params.factoryAddress).toBe('0x1f98431c8ad98523631ae4a59f267346ea31f984')
    expect(params.range).toEqual({ from: '99' })
  })
})
