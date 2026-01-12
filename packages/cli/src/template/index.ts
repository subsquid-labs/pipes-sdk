import { Config } from '~/types/config.js'
import { NetworkType } from '~/types/network.js'
import { TransformerTemplate } from '~/types/templates.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'
import { getSinkTemplate, renderSinkTemplate } from './pipes/evm/sink-templates.js'
import { evmTemplates } from './pipes/evm/transformer-templates.js'
import { svmTemplates } from './pipes/svm/transformer-templates.js'

export interface BuiltTemplateEntry extends Pick<TransformerTemplate, 'compositeKey' | 'transformer' | 'tableName' | 'drizzleTableName'> {
  variableName: string
  table: string | undefined
  hasTable: boolean
  excludeFromInsert: boolean
  last: boolean
}

export interface TemplateValues {
  network: string
  mergedImports: string[]
  templates: BuiltTemplateEntry[]
  customContracts: { compositeKey: string; address: string; eventsAlias: string }[]
  hasCustomContracts: boolean
  sinkTemplate: string
}

export abstract class TemplateBuilder<N extends NetworkType> {
  protected static readonly BASE_IMPORTS = ['import "dotenv/config"']
  protected static readonly NETWORK_IMPORTS: Record<NetworkType, string[]> = {
    evm: ['import { evmPortalSource } from "@subsquid/pipes/evm"'],
    svm: ['import { solanaPortalSource } from "@subsquid/pipes/solana"'],
  }

  constructor(protected config: Config<N>) {}

  abstract renderTemplate(templateValues: TemplateValues): string

  build() {
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

    return this.renderTemplate(values)
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

  private addBaseImports(allImportStrings: string[]): void {
    allImportStrings.push(...TemplateBuilder.BASE_IMPORTS, ...TemplateBuilder.NETWORK_IMPORTS[this.config.networkType])
  }

  private addTemplateImports(allImportStrings: string[], templateEntries: [string, TransformerTemplate][]): void {
    for (const [, value] of templateEntries) {
      if (value.imports && value.imports.length > 0) {
        allImportStrings.push(...value.imports)
      }
    }
  }

  private addSinkSpecificImports(allImportStrings: string[]) {
    const imports = this.getSinkImports()
    allImportStrings.push(...imports)
  }

  private getSinkImports() {
    const sinkTemplate = getSinkTemplate(this.config.sink)
    const { imports } = splitImportsAndCode(sinkTemplate)
    console.log(JSON.stringify({ imports }))

    return mergeImports(imports).map(generateImportStatement)
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
    const parsedImports = combinedImports ? splitImportsAndCode(combinedImports).imports : []
    const mergedImports = mergeImports(parsedImports)
    return mergedImports.map(generateImportStatement).filter((stmt: string) => stmt.length > 0)
  }

  private buildTemplateValues(
    templateEntries: [string, TransformerTemplate][],
    customContracts: { compositeKey: string; address: string; eventsAlias: string }[],
    isCustomContractFlow: boolean,
    mergedImportStatements: string[],
  ): TemplateValues {
    // TODO: change all templates to transformerTemplates
    const transformerTemplates = this.buildTemplateEntries(templateEntries, isCustomContractFlow)

    return {
      network: this.config.network,
      mergedImports: mergedImportStatements,
      templates: transformerTemplates,
      customContracts,
      hasCustomContracts: isCustomContractFlow,
      sinkTemplate: renderSinkTemplate(this.config.sink, {
        templates: transformerTemplates,
        hasCustomContracts: isCustomContractFlow,
      }),
    }
  }

  private buildTemplateEntries(templateEntries: [string, TransformerTemplate][], isCustomContractFlow: boolean): BuiltTemplateEntry[] {
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

export const templates = {
  evm: evmTemplates,
  svm: svmTemplates,
} as const satisfies Record<NetworkType, typeof evmTemplates | typeof svmTemplates>

export type NetworkTemplate<N extends NetworkType> = Partial<(typeof templates)[N]>
