import { EvmNetworkConfig } from '~/commands/init/config/networks.js'
import { EvmTemplateIds, SvmTemplateIds } from '~/commands/init/config/templates.js'
import { ContractMetadata } from '~/services/sqd-abi.js'

export type WithContractMetadata<T extends object> = T & { contracts: ContractMetadata[] }

export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  network: string // slug from networks
  templates: TransformerTemplate<N>[]
  contractAddresses: string[]
  sink: Sink
  packageManager: PackageManager
}

export const packageManagerTypes = [
  { name: 'pnpm', value: 'pnpm' },
  { name: 'yarn', value: 'yarn' },
  { name: 'npm', value: 'npm' },
  { name: 'bun', value: 'bun' },
] as const
export type PackageManager = (typeof packageManagerTypes)[number]['value']

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

export interface EvmTransformerTemplate {
  network: EvmNetworkConfig
  contractAddresses: string[]
}

export interface EnrichedEvmTemplate {
  contracts: ContractMetadata[]
}

// - Project name
// - Templates or custom
// - If templates
//    - template
//    - network
// - If custom
//    - network
//    - contract address
//    - events
