import { Config, NetworkType } from '~/types/init.js'

export interface TransformerTemplateBuilder {
  templateId?: string
  templateIds?: string[]
  code: string
}

export abstract class BaseTransformerBuilder<N extends NetworkType> {
  protected indexPath = 'src/index.ts'

  constructor(protected config: Config<N>) {}

  abstract getTemplate(): string

  abstract getTransformerTemplates(): Promise<TransformerTemplateBuilder[]>

  abstract getNetworkImports(): string[]
}
