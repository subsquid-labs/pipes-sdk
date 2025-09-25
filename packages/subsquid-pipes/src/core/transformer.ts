import { PortalClient } from '../portal-client'
import { Logger } from './logger'
import { BatchCtx } from './portal-source'
import { ProfilerOptions } from './profiling'
import { Metrics } from './prometheus-metrics'
import { BlockCursor, Ctx } from './types'

export type StartCtx = { state: { current?: BlockCursor; initial: number }; logger: Logger; metrics: Metrics }
export type QueryCtx<Query> = { queryBuilder: Query; portal: PortalClient; logger: Logger }

export interface TransformerOptions<In, Out, Query = any> {
  profiler?: ProfilerOptions
  query?: (ctx: QueryCtx<Query>) => void | Promise<void>
  start?: (ctx: StartCtx) => Promise<void> | void
  transform: (data: In, ctx: BatchCtx) => Promise<Out> | Out
  fork?: (cursor: BlockCursor, ctx: Ctx) => Promise<void> | void
  stop?: (ctx: { logger: Logger }) => Promise<void> | void
}

export class Transformer<In, Out, Query = any> {
  constructor(public options: TransformerOptions<In, Out, Query>) {}

  children: Transformer<any, any>[] = []

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

  async transform(data: In, ctx: BatchCtx) {
    const span = ctx.profiler.start(this.options.profiler?.id || 'anonymous')
    let res = await this.options.transform(data, { ...ctx, profiler: span })

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
  pipe<Res>(transformer: TransformerOptions<Out, Res, Query>): Transformer<In, Res, Query> {
    this.children.push(transformer instanceof Transformer ? transformer : createTransformer(transformer))

    return this as unknown as Transformer<In, Res, Query>
  }
}

export function createTransformer<In, Out, Query = any>(options: TransformerOptions<In, Out, Query>) {
  return new Transformer<In, Out, Query>(options)
}

export type ExtensionOut<In, Arg extends Record<string, Transformer<any, any>>> = In & {
  [K in keyof Arg]: Arg[K] extends Transformer<any, infer Out> ? Out : never
}

/**
 * Combines multiple named transformers into a single transformer whose output is an object
 * with the same keys as the input transformers and values containing each transformer's output.
 *
 * This is useful for running several transformers in parallel on the same input and merging their
 * results into a single object. Each transformer receives the same input, and their outputs are
 * collected under their respective keys.
 *
 * @param extend - An object whose values are Transformer instances to be combined.
 * @returns A new Transformer that, when run, calls each sub-transformer and returns an object with their results.
 *
 * Example:
 * ```ts
 * const t1 = createTransformer<string, number>({ transform: s => s.length });
 * const t2 = createTransformer<string, boolean>({ transform: s => s.startsWith('a') });
 * const combined = extendTransformer<{ input: string }, { len: typeof t1, isA: typeof t2 }, any>({
 *   len: t1,
 *   isA: t2,
 * });
 * // combined.transform('apple') yields: { len: 5, isA: true }
 * ```
 *
 * All lifecycle methods (`query`, `start`, `stop`, `fork`) are forwarded to each sub-transformer.
 */
export function extendTransformer<
  In,
  Arg extends Record<string, Transformer<any, any>>,
  Query,
  Res = { [K in keyof Arg]: Arg[K] extends Transformer<any, infer Out> ? Out : never },
>(extend: Arg) {
  return new Transformer<In, Res, Query>({
    profiler: { id: 'extend' },
    query: (ctx) => {
      for (const key in extend) {
        extend[key].query?.(ctx)
      }
    },
    start: async (ctx) => {
      await Promise.all(Object.values(extend).map((e) => e.start?.(ctx)))
    },
    stop: async (ctx) => {
      await Promise.all(Object.values(extend).map((e) => e.stop?.(ctx)))
    },
    fork: async (cursor, ctx) => {
      await Promise.all(Object.values(extend).map((e) => e.fork?.(cursor, ctx)))
    },
    transform: async (data, ctx) => {
      const res = data as any
      for (const key in extend) {
        res[key] = await extend[key].transform(data, ctx)
      }
      return res
    },
  })
}
