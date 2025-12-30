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

function parseTemplateFile(relativePath: string): {
  imports: string[]
  code: string
} {
  const content = readTemplateFile(relativePath)
  const { imports, code } = parseImports(content)
  return {
    imports: imports.map(generateImportStatement).filter((stmt) => stmt.length > 0),
    code,
  }
}

export const evmTemplates: Record<EvmTemplateIds, TransformerTemplate> = {
  custom: (() => {
    const parsed = parseTemplateFile('custom-contract/transformer.ts')
    return {
      compositeKey: 'custom',
      transformer: parsed.code,
      imports: parsed.imports,
      tableName: 'custom_contract',
      drizzleTableName: 'customContract',
      drizzleSchema: readTemplateFile('custom-contract/pg-table.ts'),
      clickhouseTableTemplate: readTemplateFile('custom-contract/clickhouse-table.sql'),
    }
  })(),
  'erc20-transfers': (() => {
    const parsed = parseTemplateFile('erc20-transfers/transformer.ts')
    return {
      compositeKey: 'transfers',
      tableName: 'erc20_transfers',
      transformer: parsed.code,
      imports: parsed.imports,
      clickhouseTableTemplate: readTemplateFile('erc20-transfers/clickhouse-table.sql'),
      drizzleTableName: 'erc20TransfersTable',
      drizzleSchema: readTemplateFile('erc20-transfers/pg-table.ts'),
    }
  })(),
  'uniswap-v3-swaps': (() => {
    const parsed = parseTemplateFile('uniswap-v3-swaps/transformer.ts')
    return {
      compositeKey: 'swaps',
      tableName: 'uniswap_v3_swaps',
      transformer: parsed.code,
      imports: parsed.imports,
      clickhouseTableTemplate: readTemplateFile('uniswap-v3-swaps/clickhouse-table.sql'),
      drizzleTableName: 'uniswapV3Swaps',
      drizzleSchema: readTemplateFile('uniswap-v3-swaps/pg-table.ts'),
    }
  })(),
}
