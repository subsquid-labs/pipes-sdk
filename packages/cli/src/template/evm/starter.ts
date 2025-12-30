import Mustache from 'mustache'
import { Config } from '~/types/config.js'
import { NetworkType } from '~/types/network.js'
import { Sink } from '~/types/sink.js'
import { generateImportStatement, mergeImports, parseImports } from '~/utils/merge-imports.js'
import { clickhouseSinkTemplate, postgresSinkTemplate } from './sink-templates.js'

export const template = (sink: Sink) => `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

export async function main() {
  await evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
  })
  .pipeComposite({
{{#templates}}
    {{{compositeKey}}}: {{{transformer}}},
{{/templates}}
{{#customContracts}}
    {{{compositeKey}}}: evmDecoder({
      range: { from: 'latest' },
      contracts: ["{{{address}}}"],
      /**
       * Or optionally use only a subset of events by passing the events object directly:
       * \`\`\`ts
       * events: {
       *   transfers: erc20.events.Transfer,
       * },
       * \`\`\`
       */
      events: {{{eventsAlias}}}, 
    }),
{{/customContracts}}
  })
  /**
   * Start transforming the data coming from the source.
   * \`\`\`ts
   * .pipe(({ contract1 }) => {
   *   return contract1.SomeEvent.map(e => {
   *     // do something
   *   })
   * })
   * \`\`\`
   */
  .pipeTo(${sink === 'clickhouse' ? clickhouseSinkTemplate : postgresSinkTemplate})
}

void main()
`

export function renderStarterTemplate(config: Config<NetworkType>): string {
  const templateEntries = Object.entries(config.templates)
  const isCustomContractFlow = config.contractAddresses.length > 0

  // Build contract imports and custom contracts for custom contract flow (single contract)
  const contractImports = isCustomContractFlow
    ? [
        {
          address: config.contractAddresses[0]!,
          eventsAlias: 'contract1Events',
        },
      ]
    : []

  const customContracts = isCustomContractFlow
    ? [
        {
          compositeKey: 'contract1',
          address: config.contractAddresses[0]!,
          eventsAlias: 'contract1Events',
        },
      ]
    : []

  // Collect all imports from various sources
  const allImportStrings: string[] = []

  // 1. Base imports
  allImportStrings.push('import "dotenv/config"')
  allImportStrings.push('import { evmDecoder, evmPortalSource, commonAbis } from "@subsquid/pipes/evm"')

  // 2. Template imports
  // if (!isCustomContractFlow) {
  for (const [, value] of templateEntries) {
    if (value.imports && value.imports.length > 0) {
      allImportStrings.push(...value.imports)
    }
  }
  // }

  // 3. Sink-specific imports
  if (config.sink === 'clickhouse') {
    allImportStrings.push(
      'import { clickhouseTarget } from "@subsquid/pipes/targets/clickhouse"',
      'import { createClient } from "@clickhouse/client"',
      'import { toSnakeKeysArray } from "./utils/index.js"',
    )
  } else {
    allImportStrings.push(
      'import { chunk, drizzleTarget } from "@subsquid/pipes/targets/drizzle/node-postgres"',
      'import { drizzle } from "drizzle-orm/node-postgres"',
    )
  }

  // 4. Schema imports
  if (config.sink === 'postgresql') {
    for (const [, value] of templateEntries) {
      if (value.drizzleTableName) {
        allImportStrings.push(`import { ${value.drizzleTableName} } from "./schemas.js"`)
      }
    }
  }

  // 5. Contract imports
  for (const contract of contractImports) {
    allImportStrings.push(`import { events as ${contract.eventsAlias} } from "./contracts/${contract.address}.js"`)
  }

  // Parse and merge all imports to avoid duplicates
  const combinedImports = allImportStrings.join('\n')
  const parsedImports = combinedImports ? parseImports(combinedImports).imports : []
  const mergedImports = mergeImports(parsedImports)
  const mergedImportStatements = mergedImports.map(generateImportStatement).filter((stmt: string) => stmt.length > 0)

  const values = {
    network: config.network,
    mergedImports: mergedImportStatements,
    // Include templates for table creation/registration, but exclude from insert code generation
    templates: templateEntries.map(([key, value], index) => {
      const table = config.sink === 'clickhouse' ? value.clickhouseTableTemplate : value.drizzleSchema
      // For custom template in custom contract flow, include table but exclude from insert code
      const isCustomInCustomFlow = isCustomContractFlow && key === 'custom'
      return {
        compositeKey: value.compositeKey,
        transformer: value.transformer,
        tableName: value.tableName,
        drizzleTableName: value.drizzleTableName,
        table,
        hasTable: Boolean(table),
        // Exclude custom template from generating insert code when in custom contract flow
        excludeFromInsert: isCustomInCustomFlow,
        last: index === templateEntries.length - 1,
      }
    }),
    customContracts,
    hasCustomContracts: isCustomContractFlow,
  }

  return Mustache.render(template(config.sink), values)
}
