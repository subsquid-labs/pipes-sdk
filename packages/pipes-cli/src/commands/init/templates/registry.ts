import type { NetworkType } from '~/types/init.js'

import { customTemplate as evmCustomTemplate } from './pipes/evm/custom/template.config.js'
import { erc20TransfersTemplate } from './pipes/evm/erc20-transfers/template.config.js'
import { uniswapV3SwapsTemplate } from './pipes/evm/uniswap-v3-swaps/template.config.js'
import { customTemplate as svmCustomTemplate } from './pipes/svm/custom/template.config.js'
import { tokenBalancesTemplate } from './pipes/svm/token-balances/template.config.js'
import type { Template } from './template.js'

type RegistryMap = {
  [N in NetworkType]: Record<string, Template<N, any>>
}

export const templateRegistry: RegistryMap = {
  evm: {
    custom: evmCustomTemplate,
    erc20Transfers: erc20TransfersTemplate,
    uniswapV3Swaps: uniswapV3SwapsTemplate,
  },
  svm: {
    custom: svmCustomTemplate,
    tokenBalances: tokenBalancesTemplate,
  },
}

export function getTemplate<N extends NetworkType>(networkType: N, templateId: string): Template<N, any> | undefined {
  return templateRegistry[networkType][templateId] as Template<N, any> | undefined
}

export function getTemplates<N extends NetworkType>(networkType: N): Template<N, any>[] {
  return Object.values(templateRegistry[networkType]) as Template<N, any>[]
}
