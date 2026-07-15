import { z } from 'zod'

import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'

import { extractCreateTableNames } from '../../../../builders/target-builder/shared.js'
import { defineTemplate } from '../../../define-template.js'
import { renderTemplate } from './templates/transformer.js'

const templateReader = new TemplateReader(getTemplateDirname('evm'), 'uniswap-v3-swaps')

const defaults = {
  factoryAddress: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
  range: { from: '12,369,621' },
}

export const UniswapV3SwapsPipeTemplateParamsSchema = z.object({
  factoryAddress: z
    .string()
    .default(defaults.factoryAddress)
    .describe('The Uniswap V3 compatible factory address to dynamically track pools'),
  range: z
    .object({ from: z.string(), to: z.string().optional() })
    .default(defaults.range)
    .describe('Block range for indexing'),
})

export type UniswapV3SwapsPipeTemplateParams = z.infer<typeof UniswapV3SwapsPipeTemplateParamsSchema>

export const uniswapV3SwapsTemplate = defineTemplate({
  id: 'uniswapV3Swaps',
  name: 'Uniswap V3 Swaps',
  networkType: 'evm',
  paramsSchema: UniswapV3SwapsPipeTemplateParamsSchema,
  defaultParams: defaults,
  copySrc: 'src',
  async prompt(ctx) {
    const factoryAddress = await ctx.text('Uniswap V3 compatible factory address', defaults.factoryAddress)
    const range = await ctx.blockRange('Block range', { contractAddresses: [factoryAddress.trim()] })
    return { factoryAddress: factoryAddress.trim(), range }
  },
  render(params) {
    const clickhouseTable = templateReader.readClickhouseTable()

    return {
      transformer: renderTemplate(params),
      postgresSchema: templateReader.readPgTable(),
      clickhouseTable,
      decoderIds: ['uniswapV3Swaps'],
      tables: extractCreateTableNames(clickhouseTable).map((table) => ({ decoderId: 'uniswapV3Swaps', table })),
    }
  },
})
