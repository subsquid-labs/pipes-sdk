import { input } from '@inquirer/prompts'
import chalk from 'chalk'
import { z } from 'zod'
import { PipeTemplateMeta } from '~/types/init.js'
import { promptBlockRange } from '~/utils/block-range-prompt.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'
import { renderTransformer } from './templates/transformer.js'

const templateReader = new TemplateReader(getTemplateDirname('evm'), 'erc20-transfers')

const defaults = {
  contractAddresses: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
  range: { from: '12,369,621' },
}

export const Erc20TransfersPipeTemplateParamsSchema = z.object({
  contractAddresses: z
    .array(z.string())
    .default(defaults.contractAddresses)
    .describe('Array of erc20 contract addresses to track'),
  range: z
    .object({ from: z.string(), to: z.string().optional() })
    .default(defaults.range)
    .describe('Block range for indexing'),
})
export type Erc20TransfersPipeTemplateParams = z.infer<typeof Erc20TransfersPipeTemplateParamsSchema>

class Erc20TransfersTemplate extends PipeTemplateMeta<'evm', typeof Erc20TransfersPipeTemplateParamsSchema> {
  templateId = 'erc20Transfers'
  templateName = 'Erc20 Transfers'
  networkType = 'evm' as const

  override paramsSchema = Erc20TransfersPipeTemplateParamsSchema
  override defaultParams = defaults

  override async collectParamsCustom(network: string) {
    const addressesInput = await input({
      default: defaults.contractAddresses.join(','),
      message: `ERC20 contract addresses ${chalk.dim('Comma separated')}:`,
      validate: (v: string) => (v.trim().length > 0 ? true : 'Value cannot be empty'),
    })
    const contractAddresses = addressesInput.split(',').map((a) => a.trim())

    const range = await promptBlockRange({
      networkType: 'evm',
      network,
      contractAddresses,
    })

    this.setParams({ contractAddresses, range })
  }

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