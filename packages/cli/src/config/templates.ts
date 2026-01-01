import { NetworkType } from '~/types/network.js'

export const evmTemplateOptions = [
  {
    name: 'Erc20 Transfers',
    id: 'erc20-transfers',
  },
  {
    name: 'Uniswap V3 Swaps',
    id: 'uniswap-v3-swaps',
  },
  {
    name: 'Morpho Blue',
    id: 'morpho-blue',
  },
  {
    name: 'Uniswap V4',
    id: 'uniswap-v4',
  },
  {
    name: 'Polymarket',
    id: 'polymarket',
  },
] as const

export type EvmTemplateIds = (typeof evmTemplateOptions)[number]['id'] | 'custom'

export const svmTemplateOptions = [
  {
    name: 'Orca Swaps',
    id: 'orca-swaps',
  },
] as const

export type SolanaTemplateIds = (typeof svmTemplateOptions)[number]['id'] | 'custom'

export const templateOptions = {
  evm: evmTemplateOptions,
  svm: svmTemplateOptions,
} as const satisfies Record<NetworkType, typeof evmTemplateOptions | typeof svmTemplateOptions>
