import { Config, NetworkType, WithContractMetadata } from '~/types/init.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'
import { renderTransformerTemplate } from '../pipe-templates/evm/custom/transformer.js'
import { evmTemplates } from '../pipe-templates/evm/index.js'
import { svmTemplates } from '../pipe-templates/svm/index.js'
import { getEnvTemplate } from './env.js'
import { renderSinkTemplate } from './sink-templates.js'

export interface BuiltTransformerTemplate {
  templateId: string
  code: string
}

export interface TemplateValues {
  network: string
  deduplicatedImports: string[]
  transformerTemplates: BuiltTransformerTemplate[]
  sinkTemplate: string
  envTemplate: string
}

export abstract class TemplateBuilder<N extends NetworkType> {
  protected static readonly BASE_IMPORTS = ['import "dotenv/config"']
  protected static readonly NETWORK_IMPORTS: Record<NetworkType, string[]> = {
    evm: ['import { evmPortalSource } from "@subsquid/pipes/evm"'],
    svm: ['import { solanaPortalSource } from "@subsquid/pipes/solana"'],
  }

  constructor(protected config: WithContractMetadata<Config<N>>) {}

  abstract renderTemplate(templateValues: TemplateValues): string

  async build() {
    const transformerTemplates = await this.getTransformerTemplates()
    const sinkTemplates = this.getSinkTemplate()
    const envTemplate = getEnvTemplate(this.config.sink)

    // TODO: rename this
    const componentsCode = [
      TemplateBuilder.BASE_IMPORTS,
      TemplateBuilder.NETWORK_IMPORTS[this.config.networkType],
      envTemplate,
      sinkTemplates,
      transformerTemplates.map((t) => t.code),
    ].flat()

    const deduplicatedImports = this.deduplicateImports(componentsCode)

    const sinkCode = splitImportsAndCode(sinkTemplates).code
    const envCode = splitImportsAndCode(envTemplate).code
    const transformersCode = transformerTemplates.map((t) => ({
      templateId: t.templateId,
      code: splitImportsAndCode(t.code).code,
    }))

    return this.renderTemplate({
      network: this.config.network,
      deduplicatedImports,
      envTemplate: envCode,
      transformerTemplates: transformersCode,
      sinkTemplate: sinkCode,
    })
  }

  private getTransformerTemplates() {
    return Promise.all(
      this.config.templates.map(async (template) => {
        if (template.templateId === 'custom') {
          return {
            code: renderTransformerTemplate(this.config),
            templateId: 'custom',
          }
        }
        return { code: template.code, templateId: template.templateId }
      }),
    )
  }

  private getSinkTemplate() {
    const hasCustomContracts = this.config.contractAddresses.length > 0
    return renderSinkTemplate(this.config.sink, {
      templates: this.config.templates,
      // TODO: remove hasCustomContracts. not used anymore
      hasCustomContracts,
      ...(hasCustomContracts ? { contracts: this.config.contracts } : {}),
    })
  }

  private deduplicateImports(templates: string[]) {
    const imports = templates.map(splitImportsAndCode).flatMap(({ imports }) => imports)
    return mergeImports(imports).map(generateImportStatement)
  }
}

export const templates: Record<NetworkType, typeof evmTemplates | typeof svmTemplates> = {
  evm: evmTemplates,
  svm: svmTemplates,
}

export type NetworkTemplate<N extends NetworkType> = keyof (typeof templates)[N]
