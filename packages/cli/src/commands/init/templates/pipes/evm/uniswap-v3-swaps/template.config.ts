import { input } from '@inquirer/prompts'
import { z } from 'zod'
import { PipeTemplateMeta } from '~/types/init.js'
import { promptBlockRange } from '~/utils/block-range-prompt.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'
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

class UniswapV3SwapsTemplate extends PipeTemplateMeta<'evm', typeof UniswapV3SwapsPipeTemplateParamsSchema> {
  templateId = 'uniswapV3Swaps'
  templateName = 'Uniswap V3 Swaps'
  networkType = 'evm' as const

  override paramsSchema = UniswapV3SwapsPipeTemplateParamsSchema
  override defaultParams = defaults

  override async collectParamsCustom(network: string) {
    const factoryAddress = await input({
      default: defaults.factoryAddress,
      message: 'Uniswap V3 compatible factory address:',
      validate: (v: string) => (v.trim().length > 0 ? true : 'Value cannot be empty'),
    })

    const range = await promptBlockRange({
      networkType: 'evm',
      network,
      contractAddresses: [factoryAddress.trim()],
    })

    this.setParams({ factoryAddress: factoryAddress.trim(), range })
  }

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
