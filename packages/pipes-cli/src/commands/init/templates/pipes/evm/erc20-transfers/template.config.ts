import { z } from 'zod'

import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'

import { defineTemplate } from '../../../define-template.js'
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

export const erc20TransfersTemplate = defineTemplate({
  id: 'erc20Transfers',
  name: 'ERC-20 Transfers',
  networkType: 'evm',
  paramsSchema: Erc20TransfersPipeTemplateParamsSchema,
  defaultParams: defaults,
  async prompt(ctx) {
    const addressesInput = await ctx.text(
      'ERC20 contract addresses (comma separated)',
      defaults.contractAddresses.join(','),
    )
    const contractAddresses = addressesInput
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
    const range = await ctx.blockRange('Block range')
    return { contractAddresses, range }
  },
  render(params) {
    return {
      transformer: renderTransformer(params),
      postgresSchema: templateReader.readPgTable(),
      clickhouseTable: templateReader.readClickhouseTable(),
      decoderIds: ['erc20Transfers'],
    }
  },
})
