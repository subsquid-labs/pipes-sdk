import { z } from 'zod'
import { PipeTemplateMeta } from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateParser } from '../../template-parser.js'
import { renderTemplate } from './transformer.js'

const templateParaser = new TemplateParser(getTemplateDirname('evm'), 'uniswap-v3-swaps')

export const UniswapV3SwapsPipeTemplateParamsSchema = z.object({
  factoryAddress: z
    .string()
    .default('0x1f98431c8ad98523631ae4a59f267346ea31f984')
    .describe('The Uniswap V3 compatible factory address to dynamically track pools'),
})
export const uniswapV3Swaps: PipeTemplateMeta<'evm', typeof UniswapV3SwapsPipeTemplateParamsSchema> = {
  templateId: 'uniswapV3Swaps' as const,
  templateName: 'Uniswap V3 Swaps' as const,
  networkType: 'evm' as const,
  paramsSchema: UniswapV3SwapsPipeTemplateParamsSchema,
  templateFn(network, sink, params) {
    return {
      templateId: this.templateId,
      networkType: this.networkType,
      network,
      params,
      sink,
      renderFns: {
        transformers: () => renderTemplate({ params }),
        postgresSchemas: () => templateParaser.readPgTable(),
        clickhouseTables: () => templateParaser.readClickhouseTable(),
      },
    }
  },
}

export type UniswapV3SwapsParams = {
  params: z.infer<typeof UniswapV3SwapsPipeTemplateParamsSchema>
}
