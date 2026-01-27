import { findDuplicates } from '~/internal/array.js'

import { Transformer } from './transformer.js'

export type CompositePipe<T extends Record<string, Transformer<any, any>>> = {
  [K in keyof T]: T[K] extends Transformer<any, infer Out> ? Out : never
}

/**
 * @internal
 * Combines multiple named transformers into a single transformer whose output is an object
 * with the same keys as the input transformers and values containing each transformer's output.
 *
 * This is useful for running several transformers in parallel on the same input and merging their
 * results into a single object. Each transformer receives the same input, and their outputs are
 * collected under their respective keys.
 *
 * @param composite - An object whose values are Transformer instances to be combined.
 * @returns A new Transformer that, when run, calls each sub-transformer and returns an object with their results.
 *
 * Example:
 * ```ts
 * const t1 = createTransformer<string, number>({ transform: s => s.length });
 * const t2 = createTransformer<string, boolean>({ transform: s => s.startsWith('a') });
 * const combined = compositeTransformer<{ input: string }, { len: typeof t1, isA: typeof t2 }, any>({
 *   len: t1,
 *   isA: t2,
 * });
 * // combined.transform('apple') yields: { len: 5, isA: true }
 * ```
 *
 * All lifecycle methods (`query`, `start`, `stop`, `fork`) are forwarded to each sub-transformer.
 */
export function compositeTransformer<
  In,
  Arg extends Record<string, Transformer<any, any>>,
  Query,
  Res = CompositePipe<Arg>,
>(composite: Arg) {
  const duplicates = findDuplicates(Object.values(composite).map((v) => v.id()))
  for (const key in composite) {
    const id = composite[key].id()
    if (duplicates.includes(id)) {
      composite[key].setId(`${key} / ${id}`)
    }
  }

  return new Transformer<In, Res, Query>({
    profiler: { id: 'extend' },
    query: async (ctx) => {
      await Promise.all(Object.values(composite).map((e) => e.query?.(ctx)))
    },
    start: async (ctx) => {
      await Promise.all(Object.values(composite).map((e) => e.start?.(ctx)))
    },
    stop: async (ctx) => {
      await Promise.all(Object.values(composite).map((e) => e.stop?.(ctx)))
    },
    fork: async (cursor, ctx) => {
      await Promise.all(Object.values(composite).map((e) => e.fork?.(cursor, ctx)))
    },
    transform: async (data, ctx) => {
      const res = data as any
      for (const key in composite) {
        res[key] = await composite[key].transform(data, ctx)
      }
      return res
    },
  })
}
