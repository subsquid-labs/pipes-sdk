import type { z } from 'zod'

import type { NetworkType } from '~/types/init.js'

export interface TemplateArtifacts {
  transformer: string
  postgresSchema: string
  clickhouseTable: string
  decoderIds: string[]
}

export interface TemplateContext<N extends NetworkType> {
  network: string
  projectPath: string
  networkType: N
}

export type InferTemplateParams<Schema extends z.ZodObject | undefined> = Schema extends z.ZodObject
  ? z.infer<Schema>
  : undefined

export interface Template<N extends NetworkType, P = undefined> {
  readonly id: string
  readonly name: string
  readonly networkType: N
  readonly paramsSchema?: z.ZodObject
  readonly defaultParams?: P
  readonly disabled?: boolean
  readonly copySrc?: string | boolean
  render(params: P, ctx: TemplateContext<N>): TemplateArtifacts
  prompt?(ctx: unknown): Promise<P> | P
  postSetup?(params: P, ctx: TemplateContext<N>): Promise<void> | void
}

export interface ConfiguredTemplate<N extends NetworkType = NetworkType, P = unknown> {
  template: Template<N, P>
  params: P
}
