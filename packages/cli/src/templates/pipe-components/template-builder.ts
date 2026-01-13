import Mustache from 'mustache'
import { Config } from '~/types/config.js'
import { NetworkType } from '~/types/network.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'
import { customContractTemplate } from '../pipe-templates/evm/custom/transformer.js'
import { evmTemplates } from '../pipe-templates/evm/index.js'
import { svmTemplates } from '../pipe-templates/svm/index.js'
import { renderSinkTemplate } from './sink-templates.js'

export interface BuiltTransformerTemplate {
  name: string
  code: string
}

export interface TemplateValues {
  network: string
  deduplicatedImports: string[]
  transformerTemplates: BuiltTransformerTemplate[]
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

  buildNew() {
    const transformerTemplates = this.getTransformerTemplates()
    const sinkTemplates = this.getSinkTemplate()
    const indexFileImports = [
        TemplateBuilder.BASE_IMPORTS,
        TemplateBuilder.NETWORK_IMPORTS[this.config.networkType],
        sinkTemplates,
        transformerTemplates.map(t => t.code),
    ].flat()
    const deduplicatedImports = this.deduplicateImports(indexFileImports)


    const transformersCode = transformerTemplates.map(t => ({
      name: t.name,
      code: splitImportsAndCode(t.code).code,
    }))
    const sinkTemplate = splitImportsAndCode(this.getSinkTemplate()).code

    return this.renderTemplate({
      network: this.config.network,
      deduplicatedImports,
      transformerTemplates: transformersCode,
      sinkTemplate,
    })
  }

  private getTransformerTemplates() {
    return this.config.templates.map((template) => {
      if (template.name === 'custom') {
        const [address] = this.config.contractAddresses
        return  { code: Mustache.render(customContractTemplate, { address }), name: 'custom' }
      }
      return { code: template.code, name: template.name }
    })
  }

  private getSinkTemplate() {
    return renderSinkTemplate(this.config.sink, {
      templates: this.config.templates,
      hasCustomContracts: this.config.contractAddresses.length > 0,
    })
  }

  private deduplicateImports(templates: string[]) {
    const imports = templates.map(splitImportsAndCode).flatMap(({ imports }) => imports)
    return mergeImports(imports).map(generateImportStatement)
  }
}

export const templates = {
  evm: evmTemplates,
  svm: svmTemplates,
} as const satisfies Record<NetworkType, typeof evmTemplates | typeof svmTemplates>

export type NetworkTemplate<N extends NetworkType> = keyof typeof templates[N]
