import { EvmTemplateIds } from '~/config/templates.js'
import { getDirname } from '~/template/get-dirname.js'
import { TemplateParser } from '~/template/template-parser.js'
import { TransformerTemplate } from '~/types/templates.js'

const __dirname = getDirname('evm')
const parser = new TemplateParser(__dirname)

export const evmTemplates: Record<EvmTemplateIds, TransformerTemplate> = {
  custom: (() => {
    const parsed = parser.parseTemplateFile('custom-contract/transformer.ts')
    const drizzleSchema = parser.readTemplateFile('custom-contract/pg-table.ts')
    return {
      compositeKey: 'custom',
      transformer: parsed.code,
      imports: parsed.imports,
      variableName: parsed.variableName,
      tableName: 'custom_contract',
      clickhouseTableTemplate: parser.readTemplateFile('custom-contract/clickhouse-table.sql'),
      drizzleSchema,
      drizzleTableName: parser.extractVariableName(drizzleSchema),
    }
  })(),
  'erc20-transfers': (() => {
    const parsed = parser.parseTemplateFile('erc20-transfers/transformer.ts')
    const drizzleSchema = parser.readTemplateFile('erc20-transfers/pg-table.ts')
    return {
      compositeKey: 'transfers',
      tableName: 'erc20_transfers',
      transformer: parsed.code,
      imports: parsed.imports,
      variableName: parsed.variableName,
      clickhouseTableTemplate: parser.readTemplateFile('erc20-transfers/clickhouse-table.sql'),
      drizzleSchema,
      drizzleTableName: parser.extractVariableName(drizzleSchema),
    }
  })(),
  'uniswap-v3-swaps': (() => {
    const parsed = parser.parseTemplateFile('uniswap-v3-swaps/transformer.ts')
    const drizzleSchema = parser.readTemplateFile('uniswap-v3-swaps/pg-table.ts')
    return {
      compositeKey: 'swaps',
      tableName: 'uniswap_v3_swaps',
      transformer: parsed.code,
      imports: parsed.imports,
      variableName: parsed.variableName,
      clickhouseTableTemplate: parser.readTemplateFile('uniswap-v3-swaps/clickhouse-table.sql'),
      drizzleSchema,
      drizzleTableName: parser.extractVariableName(drizzleSchema),
    }
  })(),
  'morpho-blue': {
    compositeKey: 'swaps',
    tableName: 'morpho_blue_swaps',
    transformer: '',
    imports: [],
    clickhouseTableTemplate: '',
    drizzleTableName: 'morphoBlueSwaps',
    drizzleSchema: '',
  },
  'uniswap-v4': {
    compositeKey: 'swaps',
    tableName: 'uniswap_v4_swaps',
    transformer: '',
    imports: [],
    clickhouseTableTemplate: '',
    drizzleTableName: 'uniswapV4Swaps',
    drizzleSchema: '',
  },
  polymarket: {
    compositeKey: 'swaps',
    tableName: 'polymarket_swaps',
    transformer: '',
    imports: [],
    clickhouseTableTemplate: '',
    drizzleTableName: 'polymarketSwaps',
    drizzleSchema: '',
  },
}
