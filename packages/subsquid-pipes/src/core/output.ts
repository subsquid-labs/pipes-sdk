import { findDuplicates } from '~/internal/array.js'

import { QueryBuilder } from './query-builder.js'
import { QueryAwareTransformer } from './transformer.js'

export type Outputs<F extends {}, QB extends QueryBuilder<F>> =
  | QB
  | QueryAwareTransformer<any, any, QB>
  | Record<string, QueryAwareTransformer<any, any, QB> | QB>

/**
 * @internal
 * Combines multiple named transformers into a single transformer whose output is an object
 * with the same keys as the input transformers and values containing each transformer's output.
 *
 * This is useful for running several transformers in parallel on the same input and merging their
 * results into a single object. Each transformer receives the same input, and their outputs are
 * collected under their respective keys.
 *
 * @param input - An object whose values are Transformer instances to be combined.
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
 * All lifecycle methods (`start`, `stop`, `fork`) are forwarded to each sub-transformer.
 */
export function mergeOutputs<F extends {}, Q extends QueryBuilder<F>>(input: Outputs<F, Q>) {
  if (input instanceof QueryAwareTransformer) {
    return input
  } else if (input instanceof QueryBuilder) {
    return input.build({ transform: (data) => data })
  }

  const output: Record<string, QueryAwareTransformer<any, any, Q>> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value instanceof QueryAwareTransformer) {
      output[key] = value
    } else {
      output[key] = value.build({ transform: (data) => data })
    }
  }

  const duplicates = findDuplicates(Object.values(output).map((v) => v.id()))
  for (const key in output) {
    const id = output[key].id()
    if (duplicates.includes(id)) {
      output[key].setId(`${key} / ${id}`)
    }
  }

  return new QueryAwareTransformer<any, any, Q>(
    async (ctx) => {
      await Promise.all(Object.values(output).map((e) => e.setupQuery(ctx)))
    },
    {
      profiler: { id: 'outputs' },
      start: async (ctx) => {
        await Promise.all(Object.values(output).map((e) => e.start?.(ctx)))
      },
      stop: async (ctx) => {
        await Promise.all(Object.values(output).map((e) => e.stop?.(ctx)))
      },
      fork: async (cursor, ctx) => {
        await Promise.all(Object.values(output).map((e) => e.fork?.(cursor, ctx)))
      },
      transform: async (data, ctx) => {
        const res = {} as any
        for (const key in output) {
          res[key] = await output[key].run(data, ctx)
        }
        return res
      },
    },
  )
}
