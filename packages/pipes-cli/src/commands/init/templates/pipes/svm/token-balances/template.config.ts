import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'

import { defineTemplate } from '../../../define-template.js'

const templateReader = new TemplateReader(getTemplateDirname('svm'), 'token-balances')

export const tokenBalancesTemplate = defineTemplate({
  id: 'tokenBalances',
  name: 'Token balances',
  networkType: 'svm',
  render: () => ({
    transformer: templateReader.readTransformer(),
    postgresSchema: templateReader.readPgTable(),
    clickhouseTable: templateReader.readClickhouseTable(),
    decoderIds: ['tokenBalances'],
  }),
})
