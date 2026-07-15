import type { z } from 'zod'

import type { SqdAbiService } from '~/services/sqd-abi.js'
import type { NetworkType } from '~/types/init.js'

/**
 * One insert target of a template: which stream output feeds which SQL table.
 * `event` is set when the decoder's output is a record (rows live under
 * `data.<decoderId>.<event>`); otherwise rows are `data.<decoderId>` directly.
 */
export interface TemplateTable {
  decoderId: string
  table: string
  event?: string
}

export interface TemplateArtifacts {
  transformer: string
  postgresSchema: string
  clickhouseTable: string
  decoderIds: string[]
  /** Every table the template writes, declared by the template itself — target
   *  builders consume this instead of re-deriving grouping or parsing DDL. */
  tables: TemplateTable[]
}

export interface TemplateContext<N extends NetworkType> {
  network: string
  projectPath: string
  networkType: N
  abiService?: SqdAbiService
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
