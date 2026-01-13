import type { NetworkType } from '~/types/network.js'
import { Sink } from './sink.js'
import { TransformerTemplate } from './templates.js'

export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  network: string // slug from networks
  templates: TransformerTemplate[]
  contractAddresses: string[]
  sink: Sink // id from sinks
}
