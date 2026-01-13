import { EvmTemplateIds, SvmTemplateIds } from "~/commands/init/config/templates.js"

export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  network: string // slug from networks
  templates: TransformerTemplate<N>[]
  contractAddresses: string[]
  sink: Sink
}

export const networkTypes = [
  { name: 'EVM', value: 'evm' },
  { name: 'SVM', value: 'svm' },
] as const
export type NetworkType = (typeof networkTypes)[number]['value']

export const sinkTypes = [
  { name: 'ClickHouse', value: 'clickhouse' },
  { name: 'PostgreSQL', value: 'postgresql' },
  { name: 'Memory', value: 'memory' },
] as const
export type Sink = (typeof sinkTypes)[number]['value']

export interface TransformerTemplate<N extends NetworkType> {
  templateId: N extends 'evm' ? EvmTemplateIds : SvmTemplateIds
  folderName: string
  code: string
  tableName: string
  clickhouseTableTemplate?: string
  drizzleSchema?: string
}
