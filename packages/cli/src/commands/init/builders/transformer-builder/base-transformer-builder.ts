import { Config, NetworkType } from '~/types/init.js'

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

export interface TransformerTemplateBuilder {
  templateId: string
  code: string
}

export abstract class BaseTransformerBuilder<N extends NetworkType> {
  protected indexPath = 'src/index.ts'

  constructor(protected config: Config<N>) {}

  // TODO: move deduplication logic to this function
  // abstract renderTemplate(templateValues: TemplateValues): string

  abstract getTemplate(): string

  abstract getTransformerTemplates(): Promise<TransformerTemplateBuilder[]>

  abstract getNetworkImports(): string[]
}
