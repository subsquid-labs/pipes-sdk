import { z } from 'zod'
import { PipeTemplateMeta } from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateParser } from '../../template-parser.js'
import { renderTransformer } from './transformer.js'

const templateParaser = new TemplateParser(getTemplateDirname('evm'), 'erc20-transfers')

export const Erc20TransfersPipeTemplateParamsSchema = z.object({
  contractAddresses: z
    .array(z.string())
    .default(['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'])
    .describe('Array of erc20 contract addresses to track'),
})
export const erc20Transfers: PipeTemplateMeta<'evm', typeof Erc20TransfersPipeTemplateParamsSchema> = {
  templateId: 'erc20Transfers' as const,
  templateName: 'Erc20 Transfers' as const,
  networkType: 'evm' as const,
  paramsSchema: Erc20TransfersPipeTemplateParamsSchema,
  templateFn(network, sink, params) {
    return {
      templateId: this.templateId,
      networkType: this.networkType,
      network,
      params,
      sink,
      renderFns: {
        transformers: () => renderTransformer({ params }),
        postgresSchemas: () => templateParaser.readPgTable(),
        clickhouseTables: () => templateParaser.readClickhouseTable(),
      },
    }
  },
}

export type Erc20TransferParams = {
  params: z.infer<typeof Erc20TransfersPipeTemplateParamsSchema>
}
