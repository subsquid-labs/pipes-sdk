import { SvmTemplateIds } from '~/commands/init/config/templates.js'
import { TransformerTemplate } from "~/types/init.js"
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateParser } from '../template-parser.js'

const templateParser = new TemplateParser(getTemplateDirname('svm'))

export const svmTemplates: Record<SvmTemplateIds, TransformerTemplate> = {
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
