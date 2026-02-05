import { z } from 'zod'
import { PipeTemplateMeta } from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'
import { renderTemplate } from './templates/transformer.js'

const templateReader = new TemplateReader(getTemplateDirname('evm'), 'uniswap-v3-swaps')

const defaults = {
  factoryAddress: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
}

export const UniswapV3SwapsPipeTemplateParamsSchema = z.object({
  factoryAddress: z
    .string()
    .default(defaults.factoryAddress)
    .describe('The Uniswap V3 compatible factory address to dynamically track pools'),
})

export type UniswapV3SwapsPipeTemplateParams = z.infer<typeof UniswapV3SwapsPipeTemplateParamsSchema>

class UniswapV3SwapsTemplate extends PipeTemplateMeta<'evm', typeof UniswapV3SwapsPipeTemplateParamsSchema> {
  templateId = 'uniswapV3Swaps'
  templateName = 'Uniswap V3 Swaps'
  networkType = 'evm' as const

  override paramsSchema = UniswapV3SwapsPipeTemplateParamsSchema
  override defaultParams = defaults

  renderTransformers() {
    return renderTemplate(this.getParams())
  }

  renderPostgresSchemas() {
    return templateReader.readPgTable()
  }

  renderClickhouseTables() {
    return templateReader.readClickhouseTable()
  }
}

export const uniswapV3Swaps = new UniswapV3SwapsTemplate()
