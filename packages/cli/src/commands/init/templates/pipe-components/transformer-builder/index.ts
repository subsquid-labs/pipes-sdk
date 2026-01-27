import Mustache from 'mustache'
import { Config, NetworkType, PipeTemplateMeta } from '~/types/init.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'
import { evmTemplates } from '../../pipe-templates/evm/index.js'
import { svmTemplates } from '../../pipe-templates/svm/index.js'
import { SinkBuilder } from '../sink-builder/index.js'
import { BaseTransformerBuilder } from './base-transformer-builder.js'
import { EvmTransformerBuilder } from './evm-transformer-builder.js'
import { SvmTransformerBuilder } from './svm-transformer-builder.js'
import { ProjectWriter } from '~/commands/init/init.handler.js'

export class TransformerBuilder<N extends NetworkType> {
  protected static readonly BASE_IMPORTS = ['import "dotenv/config"']
  private transformerBuilder: BaseTransformerBuilder<NetworkType>
  private sinkBuilder: SinkBuilder

  constructor(protected config: Config<N>, protected projectWriter: ProjectWriter) {
    switch (config.networkType) {
      case 'evm':
        this.transformerBuilder = new EvmTransformerBuilder(config as Config<'evm'>)
        break
      case 'svm':
        this.transformerBuilder = new SvmTransformerBuilder(config as Config<'svm'>)
        break
    }

    this.sinkBuilder = new SinkBuilder(config, projectWriter)
  }

  async render() {
    const transformerTemplates = await this.transformerBuilder.getTransformerTemplates()
    const sinkTemplates = this.sinkBuilder.render()
    const envTemplate = this.sinkBuilder.getEnvSchema()

    // TODO: rename this
    const componentsCode = [
      TransformerBuilder.BASE_IMPORTS,
      this.transformerBuilder.getNetworkImports(),
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

    return Mustache.render(this.transformerBuilder.getTemplate(), {
      /**
       * At the moment we don't support multi-chain pipes, so network
       * will be the same for all transfomers
       */
      network: this.config.templates[0].network,
      deduplicatedImports,
      envTemplate: envCode,
      transformerTemplates: transformersCode,
      sinkTemplate: sinkCode,
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
} as const

export type NetworkTemplate<N extends NetworkType> = keyof (typeof templates)[N]
export type TemplateId<N extends NetworkType> = keyof (typeof templates)[N]

export function getTemplate<N extends NetworkType>(
  networkType: N,
  templateId: keyof (typeof templates)[N],
): PipeTemplateMeta<N, any> {
  return templates[networkType][templateId] as PipeTemplateMeta<N, any>
}
