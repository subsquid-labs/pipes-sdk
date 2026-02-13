import Mustache from 'mustache'

import { Config, NetworkType, PipeTemplateMeta } from '~/types/init.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'
import { ProjectWriter } from '~/utils/project-writer.js'

import { evmTemplates } from '../../templates/pipes/evm/index.js'
import { svmTemplates } from '../../templates/pipes/svm/index.js'
import { SinkBuilder } from '../sink-builder/index.js'
import { BaseTransformerBuilder } from './base-transformer-builder.js'
import { EvmTransformerBuilder } from './evm-transformer-builder.js'
import { SvmTransformerBuilder } from './svm-transformer-builder.js'

export class TransformerBuilder<N extends NetworkType> {
  protected static readonly BASE_IMPORTS = ['import "dotenv/config"']
  private transformerBuilder: BaseTransformerBuilder<NetworkType>
  private sinkBuilder: SinkBuilder

  constructor(
    protected config: Config<N>,
    protected projectWriter: ProjectWriter,
  ) {
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

  async writeIndexTs() {
    const indexTs = await this.render()
    this.projectWriter.createFile('src/index.ts', indexTs)
  }

  async runPostSetups() {
    await Promise.all(
      this.config.templates.map(async (t) => {
        if (t.postSetup) {
          await t.postSetup(this.config.network, this.projectWriter.getAbsolutePath())
        }
      }),
    )
  }

  async render() {
    const transformerTemplates = await this.transformerBuilder.getTransformerTemplates()
    const sinkTemplates = this.sinkBuilder.render()
    const envTemplate = this.sinkBuilder.getEnvSchema()

    // TODO: rename this variable
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
      templateIds: t.templateIds,
      code: splitImportsAndCode(t.code).code,
    }))

    return Mustache.render(this.transformerBuilder.getTemplate(), {
      /**
       * At the moment we don't support multi-chain pipes, so network
       * will be the same for all transfomers
       */
      network: this.config.network,
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

export const templates: {
  evm: Record<string, PipeTemplateMeta<'evm', any>>
  svm: Record<string, PipeTemplateMeta<'svm', any>>
} = {
  evm: evmTemplates,
  svm: svmTemplates,
} as const

export type NetworkTemplate<N extends NetworkType> = (typeof templates)[N]
export type NetworkTemplateValue<N extends NetworkType> = (typeof templates)[N][keyof NetworkTemplate<N>]
export type TemplateId<N extends NetworkType> = keyof (typeof templates)[N]

export function getTemplate<N extends NetworkType>(
  networkType: N,
  templateId: keyof (typeof templates)[N],
): PipeTemplateMeta<N, any> {
  return templates[networkType][templateId] as PipeTemplateMeta<N, any>
}

export function getTemplates<N extends NetworkType>(networkType: N): NetworkTemplateValue<N>[] {
  return Object.values(templates[networkType])
}
