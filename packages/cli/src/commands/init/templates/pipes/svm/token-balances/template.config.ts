import { PipeTemplateMeta } from '~/types/init.js'
import { TemplateReader } from '~/utils/template-reader.js'
import { getTemplateDirname } from '~/utils/fs.js'

const templateReader = new TemplateReader(getTemplateDirname('svm'), 'token-balances')

class TokenBalancesTemplate extends PipeTemplateMeta<'svm'> {
  templateId = 'tokenBalances'
  templateName = 'Token balances'
  networkType = 'svm' as const

  override renderTransformers() {
    return templateReader.readTransformer()
  }

  override renderPostgresSchemas() {
    return templateReader.readPgTable()
  }

  override renderClickhouseTables() {
    return templateReader.readClickhouseTable()
  }
}

export const tokenBalances = new TokenBalancesTemplate()