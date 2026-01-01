import { Config } from '~/types/config.js'
import { NetworkType } from '~/types/network.js'
import { evmTemplates } from './pipes/evm/transformer-templates.js'
import { svmTemplates } from './pipes/svm/templates.js'

export abstract class TemplateBuilder<N extends NetworkType> {
  constructor(protected config: Config<N>) {}

  abstract build(): Promise<string> | string
}

export const templates = {
  evm: evmTemplates,
  svm: svmTemplates,
} as const satisfies Record<NetworkType, typeof evmTemplates | typeof svmTemplates>

export type NetworkTemplate<N extends NetworkType> = Partial<(typeof templates)[N]>
