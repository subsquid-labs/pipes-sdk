export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  network: string // slug from networks
  templates: TransformerTemplate[]
  contractAddresses: string[]
  sink: Sink
}

export const chainTypes = [
  { name: 'EVM', value: 'evm' },
  { name: 'SVM', value: 'svm' },
] as const

export type NetworkType = (typeof chainTypes)[number]['value']

export type Sink = 'clickhouse' | 'postgresql' | 'memory'

export interface TransformerTemplate {
  name: string
  code: string
  tableName: string
  clickhouseTableTemplate?: string
  drizzleSchema?: string
}
