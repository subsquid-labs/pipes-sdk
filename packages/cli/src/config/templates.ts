import type { NetworkType } from '~/types/network.js'

interface TemplateOption {
  name: string
  id: string
  disabled?: boolean
}

export const evmTemplateOptions: TemplateOption[] = [
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
    disabled: true,
  },
  {
    name: 'Uniswap V4',
    id: 'uniswap-v4',
    disabled: true,
  },
  {
    name: 'Polymarket',
    id: 'polymarket',
    disabled: true,
  },
] as const

export type EvmTemplateIds = (typeof evmTemplateOptions)[number]['id'] | 'custom'

export const svmTemplateOptions: TemplateOption[] = [
  {
    name: 'Token balances',
    id: 'token-balances',
  },
] as const

export type SolanaTemplateIds = (typeof svmTemplateOptions)[number]['id'] | 'custom'

export const templateOptions = {
  evm: evmTemplateOptions,
  svm: svmTemplateOptions,
} as const satisfies Record<NetworkType, typeof evmTemplateOptions | typeof svmTemplateOptions>
