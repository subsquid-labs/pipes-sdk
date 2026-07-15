import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'

import { extractCreateTableNames } from '../../../../builders/target-builder/shared.js'
import { defineTemplate } from '../../../define-template.js'

const templateReader = new TemplateReader(getTemplateDirname('svm'), 'token-balances')

export const tokenBalancesTemplate = defineTemplate({
  id: 'tokenBalances',
  name: 'Token Balances',
  networkType: 'svm',
  render: () => {
    const clickhouseTable = templateReader.readClickhouseTable()

    return {
      transformer: templateReader.readTransformer(),
      postgresSchema: templateReader.readPgTable(),
      clickhouseTable,
      decoderIds: ['tokenBalances'],
      tables: extractCreateTableNames(clickhouseTable).map((table) => ({ decoderId: 'tokenBalances', table })),
    }
  },
})
