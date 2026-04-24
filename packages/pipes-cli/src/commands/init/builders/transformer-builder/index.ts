import Mustache from 'mustache'

import { Config, NetworkType } from '~/types/init.js'
import { generateImportStatement, mergeImports, splitImportsAndCode } from '~/utils/merge-imports.js'
import { ProjectWriter } from '~/utils/project-writer.js'
import { generatePipeId } from '~/utils/random-id.js'

import { buildSink } from '../sink-builder/index.js'
import { BaseTransformerBuilder } from './base-transformer-builder.js'
import { EvmTransformerBuilder } from './evm-transformer-builder.js'
import { SvmTransformerBuilder } from './svm-transformer-builder.js'

export class TransformerBuilder<N extends NetworkType> {
  protected static readonly BASE_IMPORTS = ['import "dotenv/config"']
  private transformerBuilder: BaseTransformerBuilder<NetworkType>

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
  }

  async writeIndexTs() {
    const indexTs = await this.render()
    this.projectWriter.createFile('src/index.ts', indexTs)
  }

  async runPostSetups() {
    await Promise.all(
      this.config.templates.map(async ({ template, params }) => {
        if (template.postSetup) {
          await template.postSetup(params, {
            network: this.config.network,
            projectPath: this.projectWriter.getAbsolutePath(),
            networkType: this.config.networkType,
          })
        }
      }),
    )
  }

  async render() {
    const transformerTemplates = await this.transformerBuilder.getTransformerTemplates()
    const sinkArtifacts = buildSink(this.config)
    const sinkTemplates = sinkArtifacts.sinkCode
    const envTemplate = sinkArtifacts.envSchema

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
      pipeId: generatePipeId(),
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
