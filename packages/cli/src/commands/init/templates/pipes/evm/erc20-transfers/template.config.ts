import { z } from 'zod'
import { PipeTemplateMeta } from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'
import { renderTransformer } from './templates/transformer.js'

const templateReader = new TemplateReader(getTemplateDirname('evm'), 'erc20-transfers')

const defaults = {
  contractAddresses: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
}

export const Erc20TransfersPipeTemplateParamsSchema = z.object({
  contractAddresses: z
    .array(z.string())
    .default(defaults.contractAddresses)
    .describe('Array of erc20 contract addresses to track'),
})
export type Erc20TransfersPipeTemplateParams = z.infer<typeof Erc20TransfersPipeTemplateParamsSchema>

class Erc20TransfersTemplate extends PipeTemplateMeta<'evm', typeof Erc20TransfersPipeTemplateParamsSchema> {
  templateId = 'erc20Transfers'
  templateName = 'Erc20 Transfers'
  networkType = 'evm' as const

  override paramsSchema = Erc20TransfersPipeTemplateParamsSchema
  override defaultParams = defaults

  override renderTransformers() {
    return renderTransformer(this.getParams())
  }

  renderPostgresSchemas() {
    return templateReader.readPgTable()
  }

  renderClickhouseTables() {
    return templateReader.readClickhouseTable()
  }
}

export const erc20Transfers = new Erc20TransfersTemplate()