import { Config, NetworkType } from '~/types/init.js'

import { renderTemplates } from '../render-templates.js'

export interface TransformerTemplateBuilder {
  templateId?: string
  templateIds?: string[]
  code: string
}

export abstract class BaseTransformerBuilder<N extends NetworkType> {
  protected indexPath = 'src/index.ts'

  constructor(protected config: Config<N>) {}

  abstract getTemplate(): string

  abstract getNetworkImports(): string[]

  /** The stream's outputs record is keyed by decoder ids — never by template ids,
   *  which diverge from the emitted decoder consts whenever a template splits
   *  into several decoders (multi-deployment contracts, divergent ranges). */
  getTransformerTemplates(): TransformerTemplateBuilder[] {
    return renderTemplates(this.config).map(({ artifacts }) =>
      artifacts.decoderIds.length === 1
        ? { code: artifacts.transformer, templateId: artifacts.decoderIds[0] }
        : { code: artifacts.transformer, templateIds: artifacts.decoderIds },
    )
  }
}
