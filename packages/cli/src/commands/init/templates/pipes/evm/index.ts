import { PipeTemplateMeta } from '~/types/init.js'

import { custom } from './custom/template.config.js'
import { erc20Transfers } from './erc20-transfers/template.config.js'
import { uniswapV3Swaps } from './uniswap-v3-swaps/template.config.js'

export const evmTemplates = {
  custom,
  erc20Transfers,
  uniswapV3Swaps,
} as const satisfies Record<string, PipeTemplateMeta<'evm', any>>

export type EvmTemplateIds = keyof typeof evmTemplates
export type EvmTemplates = typeof evmTemplates
