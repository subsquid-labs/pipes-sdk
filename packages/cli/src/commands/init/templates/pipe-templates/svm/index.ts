import { SvmTemplateIds } from '~/commands/init/config/templates.js'
import { TransformerTemplate } from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateParser } from '../template-parser.js'
import { customContractChTemplate } from './custom/clickhouse-table.sql.js'
import { customContractPgTemplate } from './custom/pg-table.js'
import { customContractTemplate } from './custom/transformer.js'

const templateParser = new TemplateParser(getTemplateDirname('svm'))

export const svmTemplates: Record<SvmTemplateIds, TransformerTemplate<'svm'>> = {
  custom: (() => ({
    templateId: 'custom',
    folderName: 'custom',
    tableName: 'custom_contract',
    code: customContractTemplate,
    drizzleSchema: customContractPgTemplate,
    clickhouseTableTemplate: customContractChTemplate,
  }))(),
  tokenBalances: (() => ({
    templateId: 'tokenBalances',
    folderName: 'token-balances',
    tableName: 'token_balances',
    ...templateParser.readTemplateFiles('token-balances'),
  }))(),
}
