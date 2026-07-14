import type { z } from 'zod'

import type { SqdAbiService } from '~/services/sqd-abi.js'
import type { NetworkType } from '~/types/init.js'

import type { InferTemplateParams, Template, TemplateArtifacts, TemplateContext } from './template.js'

export interface PromptContext {
  text(message: string, defaultValue?: string): Promise<string>
  confirm(message: string, defaultValue?: boolean): Promise<boolean>
  checkbox<T>(message: string, choices: Array<{ name: string; value: T }>): Promise<T[]>
  blockRange(message: string, opts?: { contractAddresses?: string[] }): Promise<{ from: string; to?: string }>
  abiService: SqdAbiService
  network: string
}

export interface DefineTemplateInput<N extends NetworkType, Schema extends z.ZodObject | undefined> {
  id: string
  name: string
  networkType: N
  paramsSchema?: Schema
  defaultParams?: InferTemplateParams<Schema>
  disabled?: boolean
  copySrc?: string | boolean
  render(params: InferTemplateParams<Schema>, ctx: TemplateContext<N>): TemplateArtifacts
  prompt?(ctx: PromptContext): Promise<InferTemplateParams<Schema>> | InferTemplateParams<Schema>
  postSetup?(params: InferTemplateParams<Schema>, ctx: TemplateContext<N>): Promise<void> | void
}

export function defineTemplate<N extends NetworkType, Schema extends z.ZodObject | undefined = undefined>(
  input: DefineTemplateInput<N, Schema>,
): Template<N, InferTemplateParams<Schema>> {
  return Object.freeze({
    id: input.id,
    name: input.name,
    networkType: input.networkType,
    paramsSchema: input.paramsSchema,
    defaultParams: input.defaultParams,
    disabled: input.disabled,
    copySrc: input.copySrc,
    render: input.render,
    prompt: input.prompt,
    postSetup: input.postSetup,
  }) as Template<N, InferTemplateParams<Schema>>
}
