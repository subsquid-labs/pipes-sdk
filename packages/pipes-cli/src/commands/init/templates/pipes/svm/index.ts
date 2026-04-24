import { customTemplate } from './custom/template.config.js'
import { tokenBalancesTemplate } from './token-balances/template.config.js'

export const svmTemplates = {
  custom: customTemplate,
  tokenBalances: tokenBalancesTemplate,
}

export type SvmTemplateIds = keyof typeof svmTemplates
