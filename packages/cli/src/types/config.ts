import { NetworkTemplate } from '~/template/index.js'
import type { NetworkType } from '~/types/network.js'
import { Sink } from './sink.js'

export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  network: string // slug from networks
  templates: NetworkTemplate<N> // ids from templates
  contractAddresses: string[]
  sink: Sink // id from sinks
}
