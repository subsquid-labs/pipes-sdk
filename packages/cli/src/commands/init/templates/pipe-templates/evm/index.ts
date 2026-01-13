import { EvmTemplateIds } from '~/commands/init/config/templates.js'
import { TransformerTemplate } from "~/types/init.js"
import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateParser } from '../template-parser.js'

const templateParser = new TemplateParser(getTemplateDirname('evm'))

export const evmTemplates: Record<EvmTemplateIds, TransformerTemplate> = {
  custom: (() => ({
    name: 'custom',
    folderName: 'custom',
    tableName: 'custom_contract',
    ...templateParser.readTemplateFiles('custom'),
  }))(),
  'erc20-transfers': (() => ({
    name: 'erc20Transfers',
    folderName: 'erc20-transfers',
    tableName: 'erc20_transfers',
    ...templateParser.readTemplateFiles('erc20-transfers'),
  }))(),
  'uniswap-v3-swaps': (() => ({
    name: 'uniswapV3Swaps',
    folderName: 'uniswap-v3-swaps',
    tableName: 'uniswap_v3_swaps',
    ...templateParser.readTemplateFiles('uniswap-v3-swaps'),
  }))(),

  // Coming soon templates
  'morpho-blue': {
    name: 'morphoBlueSwaps',
    folderName: 'morpho-blue',
    tableName: 'morpho_blue_swaps',
    code: '',
    clickhouseTableTemplate: '',
    drizzleSchema: '',
  },
  'uniswap-v4': {
    name: 'uniswapV4Swaps',
    folderName: 'uniswap-v4',
    tableName: 'uniswap_v4_swaps',
    code: '',
    clickhouseTableTemplate: '',
    drizzleSchema: '',
  },
  polymarket: {
    name: 'polymarketSwaps',
    folderName: 'polymarket',
    tableName: 'polymarket_swaps',
    code: '',
    clickhouseTableTemplate: '',
    drizzleSchema: '',
  },
}
