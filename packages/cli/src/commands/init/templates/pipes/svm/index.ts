import { PipeTemplateMeta } from '~/types/init.js'
import { custom } from './custom/template.config.js'
import { tokenBalances } from './token-balances/template.config.js'

export const svmTemplates = {
  custom,
  // tokenBalances,
} as const satisfies Record<string, PipeTemplateMeta<'svm', any>>

export type SvmTemplateIds = keyof typeof svmTemplates
export type SvmTemplates = typeof svmTemplates
