import Mustache from 'mustache'
import { TemplateBuilder } from '~/template/index.js'
import { Sink } from '~/types/sink.js'
import { TransformerTemplate } from '~/types/templates.js'
import { generateImportStatement, mergeImports, parseImports } from '~/utils/merge-imports.js'
import { clickhouseSinkTemplate, postgresSinkTemplate } from '../evm/sink-templates.js'

export const template = (sink: Sink) => `{{#mergedImports}}
{{{.}}}
{{/mergedImports}}

{{#templates}}
{{^excludeFromComposite}}
{{{transformer}}}

{{/excludeFromComposite}}
{{/templates}}
{{#customContracts}}
const {{{compositeKey}}} = solanaInstructionDecoder({
  range: { from: 'latest' },
  programId: [programId],
  /**
   * Or optionally use only a subset of events by passing the events object directly:
   * \`\`\`ts
   * instructions: {
   *   transfers: myProgramInstructions.instructions.Swap,
   * },
   * \`\`\`
   */
  instructions: {{{eventsAlias}}}, 
})
{{/customContracts}}

export async function main() {
  await solanaPortalSource({
    portal: 'https://portal.sqd.dev/datasets/{{network}}',
  })
  .pipeComposite({
{{#templates}}
{{^excludeFromComposite}}
    {{{variableName}}},
{{/excludeFromComposite}}
{{/templates}}
{{#customContracts}}
    {{{compositeKey}}},
{{/customContracts}}
  })
  /**
   * Start transforming the data coming from the source.
   * \`\`\`ts
   * .pipe(({ contract1 }) => {
   *   return contract1.SomeInstruction.map(e => {
   *     // do something
   *   })
   * })
   * \`\`\`
   */
  .pipeTo(${sink === 'clickhouse' ? clickhouseSinkTemplate : postgresSinkTemplate})
}

void main()
`

export class SolanaTemplateBuilder extends TemplateBuilder<'svm'> {
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
    'import { solanaInstructionDecoder, solanaPortalSource } from "@subsquid/pipes/solana"',
  ]

  build(): string {
    const templateEntries = Object.entries(this.config.templates)
    const isCustomContractFlow = this.config.contractAddresses.length > 0

    const contractImports = this.collectContractImports(isCustomContractFlow)
    const allImportStrings = this.collectAllImports(templateEntries, contractImports)
    const mergedImportStatements = this.parseAndMergeImports(allImportStrings)
    const values = this.buildTemplateValues(
      templateEntries,
      contractImports,
      isCustomContractFlow,
      mergedImportStatements,
    )
    return Mustache.render(template(this.config.sink), values)
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
        excludeFromComposite: isCustomInCustomFlow,
        last: index === templateEntries.length - 1,
      }
    })
  }

  private collectContractImports(isCustomContractFlow: boolean) {
    if (!isCustomContractFlow) {
      return []
    }
    return [
      {
        compositeKey: 'myProgram',
        address: this.config.contractAddresses[0]!,
        eventsAlias: 'myProgramInstructions',
      },
    ]
  }

  private collectAllImports(
    templateEntries: [string, any][],
    contractImports: { address: string; eventsAlias: string }[],
  ): string[] {
    const allImportStrings: string[] = []
    allImportStrings.push(...SolanaTemplateBuilder.BASE_IMPORTS)
    allImportStrings.push(...SolanaTemplateBuilder.SYNC_IMPORTS[this.config.sink])
    allImportStrings.push(...this.buildTemplateImports(templateEntries))
    allImportStrings.push(...this.buildSchemaImports(templateEntries))
    allImportStrings.push(...this.buildContractImports(contractImports))
    return allImportStrings
  }

  private buildContractImports(contractImports: { address: string; eventsAlias: string }[]): string[] {
    const imports: string[] = []
    for (const contract of contractImports) {
      imports.push(`import { events as ${contract.eventsAlias} } from "./contracts/${contract.address}/index.js"`)
      imports.push(`import { programId } from "./contracts/${contract.address}/index.js"`)
    }
    return imports
  }

  private buildTemplateImports(templateEntries: [string, any][]): string[] {
    const templateImports: string[] = []
    for (const [, value] of templateEntries) {
      if (value.imports && value.imports.length > 0) {
        templateImports.push(...value.imports)
      }
    }
    return templateImports
  }

  private buildSchemaImports(templateEntries: [string, any][]): string[] {
    const schemaImports: string[] = []
    if (this.config.sink === 'postgresql') {
      for (const [, value] of templateEntries) {
        if (value.drizzleTableName) {
          schemaImports.push(`import { ${value.drizzleTableName} } from "./schemas.js"`)
        }
      }
    }
    return schemaImports
  }

  private parseAndMergeImports(allImportStrings: string[]): string[] {
    const combinedImports = allImportStrings.join('\n')
    const parsedImports = combinedImports ? parseImports(combinedImports).imports : []
    const mergedImports = mergeImports(parsedImports)
    return mergedImports.map(generateImportStatement).filter((stmt: string) => stmt.length > 0)
  }
}
