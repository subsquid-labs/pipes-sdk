import Mustache from 'mustache'
import { TemplateBuilder } from '~/template/index.js'
import { Sink } from '~/types/sink.js'
import { TransformerTemplate } from '~/types/templates.js'
import { generateImportStatement, mergeImports, parseImports } from '~/utils/merge-imports.js'
import { clickhouseSinkTemplate, postgresSinkTemplate } from './sink-templates.js'

export const template = (sink: Sink) => `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

{{#templates}}
{{{transformer}}}

{{/templates}}
{{#customContracts}}
const {{{compositeKey}}} = evmDecoder({
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
})
{{/customContracts}}

export async function main() {
  await evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
  })
  .pipeComposite({
{{#templates}}
    {{{variableName}}},
{{/templates}}
{{#customContracts}}
    {{{compositeKey}}},
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

export class EvmTemplateBuilder extends TemplateBuilder<'evm'> {
  private static readonly SYNC_IMPORTS: Record<Sink, string[]> = {
    clickhouse: [
      'import { clickhouseTarget } from "@subsquid/pipes/targets/clickhouse"',
      'import { createClient } from "@clickhouse/client"',
      'import { toSnakeKeysArray } from "./utils/index.js"',
    ],
    postgresql: [
      'import { chunk, drizzleTarget } from "@subsquid/pipes/targets/drizzle/node-postgres"',
      'import { drizzle } from "drizzle-orm/node-postgres"',
    ],
    memory: [],
  }
  private static readonly BASE_IMPORTS: string[] = [
    'import "dotenv/config"',
    'import { evmDecoder, evmPortalSource, commonAbis } from "@subsquid/pipes/evm"',
  ]

  build(): string {
    const templateEntries = Object.entries(this.config.templates)
    const isCustomContractFlow = this.config.contractAddresses.length > 0

    const contractImports = this.buildContractImports(isCustomContractFlow)
    const customContracts = this.buildCustomContracts(isCustomContractFlow)
    const allImportStrings = this.collectAllImports(templateEntries, contractImports)
    const mergedImportStatements = this.parseAndMergeImports(allImportStrings)
    const values = this.buildTemplateValues(
      templateEntries,
      customContracts,
      isCustomContractFlow,
      mergedImportStatements,
    )

    return Mustache.render(template(this.config.sink), values)
  }

  private buildContractImports(isCustomContractFlow: boolean) {
    if (!isCustomContractFlow) {
      return []
    }
    return [
      {
        address: this.config.contractAddresses[0]!,
        eventsAlias: 'myContractEvents',
      },
    ]
  }

  private buildCustomContracts(isCustomContractFlow: boolean) {
    if (!isCustomContractFlow) {
      return []
    }
    return [
      {
        compositeKey: 'myContract',
        address: this.config.contractAddresses[0]!,
        eventsAlias: 'myContractEvents',
      },
    ]
  }

  private collectAllImports(
    templateEntries: [string, TransformerTemplate][],
    contractImports: { address: string; eventsAlias: string }[],
  ): string[] {
    const allImportStrings: string[] = []

    this.addBaseImports(allImportStrings)
    this.addTemplateImports(allImportStrings, templateEntries)
    this.addSinkSpecificImports(allImportStrings)
    this.addSchemaImports(allImportStrings, templateEntries)
    this.addContractImports(allImportStrings, contractImports)

    return allImportStrings
  }

  private addBaseImports(allImportStrings: string[]): void {
    allImportStrings.push(...EvmTemplateBuilder.BASE_IMPORTS)
  }

  private addTemplateImports(allImportStrings: string[], templateEntries: [string, TransformerTemplate][]): void {
    for (const [, value] of templateEntries) {
      if (value.imports && value.imports.length > 0) {
        const cleanedImports = value.imports.map((imp: string) =>
          imp.replace(/from\s+['"]node_modules\//g, (match) => match.replace('node_modules/', '')),
        )
        allImportStrings.push(...cleanedImports)
      }
    }
  }

  private addSinkSpecificImports(allImportStrings: string[]): void {
    allImportStrings.push(...EvmTemplateBuilder.SYNC_IMPORTS[this.config.sink])
  }

  private addSchemaImports(allImportStrings: string[], templateEntries: [string, TransformerTemplate][]): void {
    if (this.config.sink === 'postgresql') {
      for (const [, value] of templateEntries) {
        if (value.drizzleTableName) {
          allImportStrings.push(`import { ${value.drizzleTableName} } from "./schemas.js"`)
        }
      }
    }
  }

  private addContractImports(
    allImportStrings: string[],
    contractImports: { address: string; eventsAlias: string }[],
  ): void {
    for (const contract of contractImports) {
      allImportStrings.push(`import { events as ${contract.eventsAlias} } from "./contracts/${contract.address}.js"`)
    }
  }

  private parseAndMergeImports(allImportStrings: string[]): string[] {
    const combinedImports = allImportStrings.join('\n')
    const parsedImports = combinedImports ? parseImports(combinedImports).imports : []
    const mergedImports = mergeImports(parsedImports)
    return mergedImports.map(generateImportStatement).filter((stmt: string) => stmt.length > 0)
  }

  private buildTemplateValues(
    templateEntries: [string, TransformerTemplate][],
    customContracts: { compositeKey: string; address: string; eventsAlias: string }[],
    isCustomContractFlow: boolean,
    mergedImportStatements: string[],
  ) {
    return {
      network: this.config.network,
      mergedImports: mergedImportStatements,
      templates: this.buildTemplateEntries(templateEntries, isCustomContractFlow),
      customContracts,
      hasCustomContracts: isCustomContractFlow,
    }
  }

  private buildTemplateEntries(templateEntries: [string, TransformerTemplate][], isCustomContractFlow: boolean) {
    return templateEntries.map(([key, value], index) => {
      const table = this.config.sink === 'clickhouse' ? value.clickhouseTableTemplate : value.drizzleSchema
      const isCustomInCustomFlow = isCustomContractFlow && key === 'custom'
      return {
        compositeKey: value.compositeKey,
        transformer: value.transformer,
        variableName: value.variableName || value.compositeKey,
        tableName: value.tableName,
        drizzleTableName: value.drizzleTableName,
        table,
        hasTable: Boolean(table),
        excludeFromInsert: isCustomInCustomFlow,
        last: index === templateEntries.length - 1,
      }
    })
  }
}
