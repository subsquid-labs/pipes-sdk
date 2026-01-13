import type { NetworkType } from "~/types/init.js"

interface TemplateOption {
  name: string
  id: string
  disabled?: boolean
}

export const evmTemplateOptions = [
  {
    name: 'Erc20 Transfers',
    id: 'erc20Transfers',
  },
  {
    name: 'Uniswap V3 Swaps',
    id: 'uniswapV3Swaps',
  },
  {
    name: 'Morpho Blue',
    id: 'morphoBlueSwaps',
    disabled: true,
  },
  {
    name: 'Uniswap V4',
    id: 'uniswapV4Swaps',
    disabled: true,
  },
  {
    name: 'Polymarket',
    id: 'polymarket',
    disabled: true,
  },
] satisfies readonly TemplateOption[]

export const svmTemplateOptions = [
  {
    name: 'Token balances',
    id: 'tokenBalances',
  },
] satisfies readonly TemplateOption[]

export type EvmTemplateIds = (typeof evmTemplateOptions)[number]['id'] | 'custom'
export type SvmTemplateIds = (typeof svmTemplateOptions)[number]['id'] | 'custom'

export const templateOptions = {
  evm: evmTemplateOptions,
  svm: svmTemplateOptions,
} as const satisfies Record<NetworkType, typeof evmTemplateOptions | typeof svmTemplateOptions>
