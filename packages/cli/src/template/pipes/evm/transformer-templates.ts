import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EvmTemplateIds } from '~/config/templates.js'
import { TransformerTemplate } from '~/types/templates.js'
import { generateImportStatement, parseImports } from '~/utils/merge-imports.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function readTemplateFile(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8')
}

function extractVariableName(code: string): string {
  const match = code.match(/^(?:export\s+)?const\s+(\w+)\s*=/m)
  return match ? match[1] : 'unknown'
}

function parseTemplateFile(relativePath: string): {
  imports: string[]
  code: string
  variableName: string
} {
  const content = readTemplateFile(relativePath)
  const { imports, code } = parseImports(content)
  const variableName = extractVariableName(code)
  return {
    imports: imports.map(generateImportStatement).filter((stmt) => stmt.length > 0),
    code,
    variableName,
  }
}

export const evmTemplates: Record<EvmTemplateIds, TransformerTemplate> = {
  custom: (() => {
    const parsed = parseTemplateFile('custom-contract/transformer.ts')
    const drizzleSchema = readTemplateFile('custom-contract/pg-table.ts')
    return {
      compositeKey: 'custom',
      transformer: parsed.code,
      imports: parsed.imports,
      variableName: parsed.variableName,
      tableName: 'custom_contract',
      clickhouseTableTemplate: readTemplateFile('custom-contract/clickhouse-table.sql'),
      drizzleSchema,
      drizzleTableName: extractVariableName(drizzleSchema),
    }
  })(),
  'erc20-transfers': (() => {
    const parsed = parseTemplateFile('erc20-transfers/transformer.ts')
    const drizzleSchema = readTemplateFile('erc20-transfers/pg-table.ts')
    return {
      compositeKey: 'transfers',
      tableName: 'erc20_transfers',
      transformer: parsed.code,
      imports: parsed.imports,
      variableName: parsed.variableName,
      clickhouseTableTemplate: readTemplateFile('erc20-transfers/clickhouse-table.sql'),
      drizzleSchema,
      drizzleTableName: extractVariableName(drizzleSchema),
    }
  })(),
  'uniswap-v3-swaps': (() => {
    const parsed = parseTemplateFile('uniswap-v3-swaps/transformer.ts')
    const drizzleSchema = readTemplateFile('uniswap-v3-swaps/pg-table.ts')
    return {
      compositeKey: 'swaps',
      tableName: 'uniswap_v3_swaps',
      transformer: parsed.code,
      imports: parsed.imports,
      variableName: parsed.variableName,
      clickhouseTableTemplate: readTemplateFile('uniswap-v3-swaps/clickhouse-table.sql'),
      drizzleSchema,
      drizzleTableName: extractVariableName(drizzleSchema),
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
  'polymarket': {
    compositeKey: 'swaps',
    tableName: 'polymarket_swaps',
    transformer: '',
    imports: [],
    clickhouseTableTemplate: '',
    drizzleTableName: 'polymarketSwaps',
    drizzleSchema: '',
  },
}
