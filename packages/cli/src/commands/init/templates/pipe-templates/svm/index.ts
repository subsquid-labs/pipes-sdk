import { SvmTemplateIds } from '~/commands/init/config/templates.js'
import { TemplateParser } from '~/templates/pipe-templates/template-parser.js'
import { TransformerTemplate } from "~/types/init.js"
import { getTemplateDirname } from '~/utils/fs.js'

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
