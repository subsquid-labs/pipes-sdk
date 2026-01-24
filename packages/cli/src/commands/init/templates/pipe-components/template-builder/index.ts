import { Config, NetworkType, WithContractMetadata } from '~/types/init.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'
import { evmTemplates } from '../../pipe-templates/evm/index.js'
import { svmTemplates } from '../../pipe-templates/svm/index.js'
import { getEnvTemplate } from '../env.js'
import { renderSinkTemplate } from '../sink-templates.js'
import { BaseTemplateBuilder } from './base-template-builder.js'
import { EvmTemplateBuilder } from './evm-template-builder.js'
import { SvmTemplateBuilder } from './svm-template-builder.js'

export class TemplateBuilder {
  protected static readonly BASE_IMPORTS = ['import "dotenv/config"']
  private networkTemplateBuilder: BaseTemplateBuilder

  constructor(protected config: WithContractMetadata<Config<NetworkType>>) {
    switch (config.networkType) {
      case 'evm':
        this.networkTemplateBuilder = new EvmTemplateBuilder(config)
        break
      case 'svm':
        this.networkTemplateBuilder = new SvmTemplateBuilder(config)
        break
    }
  }

  async build() {
    const transformerTemplates = await this.networkTemplateBuilder.getTransformerTemplates()
    const sinkTemplates = this.getSinkTemplate()
    const envTemplate = getEnvTemplate(this.config.sink)

    // TODO: rename this
    const componentsCode = [
      TemplateBuilder.BASE_IMPORTS,
      this.networkTemplateBuilder.getNetworkImports(),
      envTemplate,
      sinkTemplates,
      transformerTemplates.map((t) => t.code),
    ].flat()

    const deduplicatedImports = this.deduplicateImports(componentsCode)

    const { code: sinkCode } = splitImportsAndCode(sinkTemplates)
    const { code: envCode } = splitImportsAndCode(envTemplate)
    const transformersCode = transformerTemplates.map((t) => ({
      templateId: t.templateId,
      code: splitImportsAndCode(t.code).code,
    }))

    return this.networkTemplateBuilder.renderTemplate({
      network: this.config.network,
      deduplicatedImports,
      envTemplate: envCode,
      transformerTemplates: transformersCode,
      sinkTemplate: sinkCode,
    })
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
