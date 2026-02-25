import { input } from '@inquirer/prompts'
import chalk from 'chalk'
import { z } from 'zod'

import { ContractMetadata } from '~/services/sqd-abi.js'
import { getDefaults } from '~/utils/zod.js'

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

export const sinkTypes = [
  { name: 'ClickHouse', value: 'clickhouse' },
  { name: 'PostgreSQL', value: 'postgresql' },
  { name: 'Memory', value: 'memory' },
] as const
export type Sink = (typeof sinkTypes)[number]['value']

export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  network: string
  templates: PipeTemplateMeta<N, any>[]
  sink: Sink
  packageManager: PackageManager
}

type InferredParams<Params extends z.ZodObject | undefined> = Params extends z.ZodObject ? z.infer<Params> : undefined

export abstract class PipeTemplateMeta<N extends NetworkType, Params extends z.ZodObject | undefined = undefined> {
  abstract readonly templateId: string
  abstract readonly templateName: string
  abstract readonly networkType: N

  abstract renderTransformers(): string
  abstract renderPostgresSchemas(): string
  abstract renderClickhouseTables(): string

  getDecoderIds(): string[] {
    return [this.templateId]
  }

  params?: InferredParams<Params>

  readonly paramsSchema?: Params extends z.ZodObject ? Params : undefined
  readonly defaultParams?: InferredParams<Params>
  readonly disabled?: boolean

  /**
   * Implement this method if the the template requires a post setup process.
   * One example is contract typegen for EVM and SVM custom templates.
   */
  postSetup?(network: string, projectPath: string): Promise<void> | void

  /**
   * Implement this method if the the template requires a complex params collection process.
   * One example is contract and event selection for EVM and SVM custom templates.
   */
  collectParamsCustom?(network: string): Promise<void>

  public setParams(params: InferredParams<Params>) {
    if (this.paramsSchema) {
      this.paramsSchema.parse(params)
      this.params = params
      return this
    }
    throw new NoParamsTemplateError()
  }

  public getParams() {
    if (this.params) return this.params
    if (this.defaultParams) return this.defaultParams
    throw new ParamsNotCollectedError()
  }

  public async promptParams(network: string) {
    if (!this.paramsSchema) return

    if (this.collectParamsCustom) await this.collectParamsCustom(network)
    else await this.collectParamsDefault()
  }

  public async collectParamsDefault() {
    const schema = this.paramsSchema

    if (!schema) throw new SchemaAndCustomPromptUndefinedError()

    const entries = Object.keys(schema.shape)
    const values: Record<string, string | string[]> = {}
    const defaultValues = getDefaults(schema)

    for (const key of entries) {
      const description = schema.shape[key].meta()?.description
      const type = schema.shape[key].type === 'default' ? schema.shape[key].unwrap().type : schema.shape[key].type
      const defaultValue = defaultValues[key]

      let formattedDefault: string | undefined
      if (defaultValue) {
        if (typeof defaultValue === 'string') {
          formattedDefault = defaultValue
        } else if (Array.isArray(defaultValue)) {
          formattedDefault = defaultValue.join(',')
        }
      }

      const value = await input({
        default: formattedDefault,
        message: `${description} ${type === 'array' ? chalk.dim(`. Comma separated`) : ''}`,
        validate: (value: string) => {
          return value.trim().length > 0 ? true : 'Value cannot be empty'
        },
      })

      values[key] = type === 'array' ? [...value.trim().split(',')].flat() : value
    }

    this.setParams(schema.parse(values) as InferredParams<Params>)
  }
}

export class ParamsNotCollectedError extends Error {
  constructor() {
    super('Params are not collected. Please call promptParams() first.')
  }
}

export class NoParamsTemplateError extends Error {
  constructor() {
    super('This template does not accept any parameters. Please check the template configuration.')
  }
}

export class SchemaAndCustomPromptUndefinedError extends Error {
  constructor() {
    super(
      'A template has to either define a params schema or a prompt function. Please check the template configuration.',
    )
  }
}
