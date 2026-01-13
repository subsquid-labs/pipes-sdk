import { EvmTemplateIds } from '~/commands/init/config/templates.js'
import { TransformerTemplate } from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateParser } from '../template-parser.js'

const templateParser = new TemplateParser(getTemplateDirname('evm'))

export const evmTemplates: Record<EvmTemplateIds, TransformerTemplate<'evm'>> = {
  custom: (() => ({
    templateId: 'custom',
    folderName: 'custom',
    tableName: 'custom_contract',
    ...templateParser.readTemplateFiles('custom'),
  }))(),
  erc20Transfers: (() => ({
    templateId: 'erc20Transfers',
    folderName: 'erc20-transfers',
    tableName: 'erc20_transfers',
    ...templateParser.readTemplateFiles('erc20-transfers'),
  }))(),
  uniswapV3Swaps: (() => ({
    templateId: 'uniswapV3Swaps',
    folderName: 'uniswap-v3-swaps',
    tableName: 'uniswap_v3_swaps',
    ...templateParser.readTemplateFiles('uniswap-v3-swaps'),
  }))(),

  // Coming soon templates
  morphoBlueSwaps: {
    templateId: 'morphoBlueSwaps',
    folderName: 'morpho-blue',
    tableName: 'morpho_blue_swaps',
    code: '',
    clickhouseTableTemplate: '',
    drizzleSchema: '',
  },
  uniswapV4Swaps: {
    templateId: 'uniswapV4Swaps',
    folderName: 'uniswap-v4',
    tableName: 'uniswap_v4_swaps',
    code: '',
    clickhouseTableTemplate: '',
    drizzleSchema: '',
  },
  polymarket: {
    templateId: 'polymarket',
    folderName: 'polymarket',
    tableName: 'polymarket',
    code: '',
    clickhouseTableTemplate: '',
    drizzleSchema: '',
  },
}
