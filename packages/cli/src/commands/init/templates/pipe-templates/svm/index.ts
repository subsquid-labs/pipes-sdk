import { SvmTemplateIds } from '~/commands/init/config/templates.js'
import { TransformerTemplate } from "~/types/init.js"
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateParser } from '../template-parser.js'

const templateParser = new TemplateParser(getTemplateDirname('svm'))

export const svmTemplates: Record<SvmTemplateIds, TransformerTemplate<'svm'>> = {
  custom: (() => ({
    templateId: 'custom',
    folderName: 'custom',
    tableName: 'custom_contract',
    ...templateParser.readTemplateFiles('custom'),
  }))(),
  tokenBalances: (() => ({
    templateId: 'tokenBalances',
    folderName: 'token-balances',
    tableName: 'token_balances',
    ...templateParser.readTemplateFiles('token-balances'),
  }))(),
}
