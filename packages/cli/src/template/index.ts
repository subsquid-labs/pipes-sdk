import { NetworkType } from '~/types/network.js'
import { evmTemplates } from './evm/transformer-templates.js'
import { svmTemplates } from './svm/templates.js'

export const templates = {
  evm: evmTemplates,
  svm: svmTemplates,
} as const satisfies Record<NetworkType, typeof evmTemplates | typeof svmTemplates>

export type NetworkTemplate<N extends NetworkType> = Partial<(typeof templates)[N]>
