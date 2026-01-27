import { z } from 'zod'
import { ContractMetadata } from '~/services/sqd-abi.js'

export type WithContractMetadata<T extends object> = T & { contracts: ContractMetadata[] }

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

export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  templates: PipeTemplate<N, any>[]
  sink: Sink
  packageManager: PackageManager
}

type InferredParams<Params> = Params extends z.ZodObject ? z.infer<Params> : Params

export interface PipeTemplate<N extends NetworkType, Params> {
  templateId: string
  networkType: N
  network: string
  params: Params
  sink: Sink
  renderFns: {
    transformers: RenderFn<N, Params>
    postgresSchemas: RenderFn<N, Params>
    clickhouseTables: RenderFn<N, Params>
  }
}

type RenderFn<N extends NetworkType, Params> = (templateConfig?: PipeTemplate<N, InferredParams<Params>>) => string

export interface PipeTemplateMeta<N extends NetworkType, Params> {
  templateId: string
  templateName: string
  networkType: N
  paramsSchema?: Params extends z.ZodObject ? Params : never
  disabled?: boolean
  prompt?: (network: string) => Promise<InferredParams<Params>>
  templateFn: (network: string, sink: Sink, params: InferredParams<Params>) => PipeTemplate<N, InferredParams<Params>>
}

export interface EnrichedEvmTemplate {
  contracts: ContractMetadata[]
}
