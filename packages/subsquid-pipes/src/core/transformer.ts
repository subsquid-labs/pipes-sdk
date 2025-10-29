import { Metrics } from '~/core/metrics-server.js'
import { PortalClient } from '~/portal-client/index.js'
import { Logger } from './logger.js'
import { BatchCtx } from './portal-source.js'
import { ProfilerOptions } from './profiling.js'
import { BlockCursor, Ctx } from './types.js'

export type StartCtx = {
  state: { current?: BlockCursor; initial: number }
  logger: Logger
  metrics: Metrics
}

export type StopCtx = { logger: Logger }
export type QueryCtx<Query> = { queryBuilder: Query; portal: PortalClient; logger: Logger }

export interface TransformerOptions<In, Out, Query = any> {
  profiler?: ProfilerOptions
  query?: (ctx: QueryCtx<Query>) => void | Promise<void>
  start?: (ctx: StartCtx) => Promise<void> | void
  transform: (data: In, ctx: BatchCtx) => Promise<Out> | Out
  fork?: (cursor: BlockCursor, ctx: Ctx) => Promise<void> | void
  stop?: (ctx: StopCtx) => Promise<void> | void
}

export class Transformer<In, Out, Query = any> {
  constructor(public options: TransformerOptions<In, Out, Query>) {}

  children: Transformer<any, any>[] = []

  id() {
    return this.options.profiler?.id || 'anonymous'
  }

  setId(profilerId: string) {
    this.options.profiler = { id: profilerId }
  }

  async query(ctx: QueryCtx<Query>) {
    await this.options.query?.(ctx)

    if (this.children.length === 0) return
    await Promise.all(this.children.map((t) => t.query(ctx)))
  }

  async start(ctx: StartCtx) {
    await this.options.start?.(ctx)

    if (this.children.length === 0) return
    await Promise.all(this.children.map((t) => t.start(ctx)))
  }

  async stop(ctx: { logger: Logger }) {
    await this.options.stop?.(ctx)

    if (this.children.length === 0) return
    await Promise.all(this.children.map((t) => t.stop(ctx)))
  }

  async fork(cursor: BlockCursor, ctx: Ctx) {
    await this.options.fork?.(cursor, ctx)

    if (this.children.length === 0) return
    await Promise.all(this.children.map((t) => t.fork(cursor, ctx)))
  }

  async transform(data: In, ctx: BatchCtx): Promise<Out> {
    const span = ctx.profiler.start(this.options.profiler?.id || 'anonymous')
    let res = await this.options.transform(data, { ...ctx, profiler: span })
    span.addTransformerExemplar(res)

    if (this.children.length === 0) {
      span.end()
      return res
    }

    for (const child of this.children) {
      res = await child.transform(res, { ...ctx, profiler: span })
    }

    span.end()
    return res
  }

  /**
   * Chains this transformer with another one.
   *
   * Type parameters:
   * - `In` – the input type of the first transformer in the chain.
   * - `Out` – the output type of this transformer (and the input of the next).
   * - `Res` – the output type of the next transformer in the chain.
   *
   * Why `In` must be inferred from the parent transformer:
   * -----------------------------------------------------
   * The second transformer only knows how to map its *input* (`Out`) to its *output* (`Res`).
   * But in the full chain, the *ultimate* input type is determined by the first transformer.
   *
   * Example:
   *   const t1 = createTransformer<string[], number[]>({ ... })
   *   const t2 = createTransformer<number[], boolean>({ ... })
   *
   *   const piped = t1.pipe(t2)
   *   // piped has type Transformer<string[], boolean>
   *
   * Notice: `t2` does not know anything about `string[]` (the original `In`).
   * Only the parent (`t1`) knows it. Therefore, when piping, we must "lift"
   * the parent's `In` into the resulting type:
   *
   *   Transformer<In, Res> instead of Transformer<Out, Res>
   *
   * Otherwise, type information about the very first input would be lost,
   * and downstream code would see only the immediate `Out` type.
   */
  pipe<Res>(
    transformer:
      | Transformer<Out, Res, Query>
      | TransformerOptions<Out, Res, Query>
      | TransformerOptions<Out, Res, Query>['transform'],
  ): Transformer<In, Res, Query> {
    this.children.push(
      transformer instanceof Transformer
        ? transformer
        : typeof transformer === 'function'
          ? createTransformer({ transform: transformer })
          : createTransformer(transformer),
    )

    return this as unknown as Transformer<In, Res, Query>
  }
}

export function createTransformer<In, Out, Query = any>(options: TransformerOptions<In, Out, Query>) {
  return new Transformer<In, Out, Query>(options)
}
