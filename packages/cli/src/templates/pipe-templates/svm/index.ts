import { SolanaTemplateIds } from '~/config/templates.js'
import { TemplateParser } from '~/templates/template-parser.js'
import { TransformerTemplate } from '~/types/templates.js'
import { getTemplateDirname } from '~/utils/fs.js'

const templateParser = new TemplateParser(getTemplateDirname('svm'))

export const svmTemplates: Record<SolanaTemplateIds, TransformerTemplate> = {
  custom: (() => ({
    name: 'custom',
    tableName: 'custom_contract',
    ...templateParser.readTemplateFiles('custom'),
  }))(),
  'token-balances': (() => ({
    name: 'tokenBalances',
    tableName: 'token_balances',
    ...templateParser.readTemplateFiles('token-balances'),
  }))(),
}
