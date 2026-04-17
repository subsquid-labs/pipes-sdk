import type { NetworkType } from '~/types/init.js'

import { getTemplate } from './registry.js'
import type { ConfiguredTemplate } from './template.js'

export function configured<N extends NetworkType>(
  networkType: N,
  templateId: string,
  params: any,
): ConfiguredTemplate<N, any> {
  const template = getTemplate(networkType, templateId)
  if (!template) {
    throw new Error(`Fixture: template ${networkType}/${templateId} not found in registry`)
  }
  return { template, params }
}

export const fixtures = {
  erc20Transfers: (overrides: Partial<{ contractAddresses: string[]; range: { from: string; to?: string } }> = {}) =>
    configured('evm', 'erc20Transfers', {
      contractAddresses: overrides.contractAddresses ?? ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
      range: overrides.range ?? { from: '12,369,621' },
    }),

  uniswapV3Swaps: (overrides: Partial<{ factoryAddress: string; range: { from: string; to?: string } }> = {}) =>
    configured('evm', 'uniswapV3Swaps', {
      factoryAddress: overrides.factoryAddress ?? '0x1f98431c8ad98523631ae4a59f267346ea31f984',
      range: overrides.range ?? { from: '12,369,621' },
    }),

  evmCustom: (contracts: any[]) => configured('evm', 'custom', { contracts }),

  svmCustom: (contracts: any[]) => configured('svm', 'custom', { contracts }),

  tokenBalances: () => configured('svm', 'tokenBalances', undefined),
}

export const wethContract = {
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
    {
      name: 'Transfer',
      type: 'event',
      inputs: [
        { name: 'src', type: 'address' },
        { name: 'dst', type: 'address' },
        { name: 'wad', type: 'uint256' },
      ],
    },
  ],
  range: { from: 'latest' },
}

export const whirlpoolContract = {
  contractAddress: '0x0000000000000000000000000000000000000000',
  contractName: 'whirpool',
  contractEvents: [
    {
      name: 'Swap',
      type: 'event',
      inputs: [
        { name: 'amount0', type: 'i128' },
        { name: 'amount1', type: 'i128' },
        { name: 'sqrt_price_x96', type: 'i128' },
      ],
    },
  ],
  range: { from: 'latest' },
}
