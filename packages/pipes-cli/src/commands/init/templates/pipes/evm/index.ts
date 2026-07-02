import { customTemplate } from './custom/template.config.js'
import { erc20TransfersTemplate } from './erc20-transfers/template.config.js'
import { uniswapV3SwapsTemplate } from './uniswap-v3-swaps/template.config.js'

export const evmTemplates = {
  custom: customTemplate,
  erc20Transfers: erc20TransfersTemplate,
  uniswapV3Swaps: uniswapV3SwapsTemplate,
}

export type EvmTemplateIds = keyof typeof evmTemplates
