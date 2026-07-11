import type { ConfiguredTemplate } from '~/commands/init/templates/template.js'
import { ContractMetadata } from '~/services/sqd-abi.js'

export type WithContractMetadata<T extends object> = T & { contracts: ContractMetadata[] }

export const packageManagerTypes = [
  { name: 'pnpm', value: 'pnpm', lockFile: 'pnpm-lock.yaml' },
  { name: 'yarn', value: 'yarn', lockFile: 'yarn.lock' },
  { name: 'npm', value: 'npm', lockFile: 'package-lock.json' },
  { name: 'bun', value: 'bun', lockFile: 'bun.lock' },
] as const
export type PackageManager = (typeof packageManagerTypes)[number]['value']

export const networkTypes = [
  { name: 'EVM', value: 'evm' },
  { name: 'SVM', value: 'svm' },
] as const
export type NetworkType = (typeof networkTypes)[number]['value']

export const targetTypes = [
  { name: 'ClickHouse', value: 'clickhouse' },
  { name: 'PostgreSQL', value: 'postgresql' },
  { name: 'Memory', value: 'memory' },
] as const
export type Sink = (typeof targetTypes)[number]['value']

export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  network: string
  templates: ConfiguredTemplate<N, any>[]
  sink: Sink
  packageManager: PackageManager
}
