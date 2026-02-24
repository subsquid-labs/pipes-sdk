import { cast } from '@subsquid/util-internal-validation'

import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'
import { PortalClientOptions, getBlockSchema } from '~/portal-client/index.js'
import * as solana from '~/portal-client/query/solana.js'

import {
  LogLevel,
  Logger,
  Outputs,
  PortalCache,
  PortalSource,
  SpanHooks,
  Transformer,
  createDefaultLogger,
  createTransformer,
  mergeOutputs,
} from '../core/index.js'
import { SolanaQueryBuilder } from './solana-query-builder.js'

export type SolanaFieldSelection = solana.FieldSelection

export type SolanaPortalData<F extends solana.FieldSelection> = solana.Block<F>[]

type SolanaOutputs = Outputs<solana.FieldSelection, SolanaQueryBuilder<any>>

type SolanaPortalStream<T extends SolanaOutputs> =
  T extends SolanaQueryBuilder<infer Q>
    ? SolanaPortalData<Q>
    : T extends Transformer<any, infer O>
      ? O
      : T extends Record<string, Transformer<any, any> | SolanaQueryBuilder<any>>
        ? {
            [K in keyof T]: T[K] extends Transformer<any, infer O>
              ? O
              : T[K] extends SolanaQueryBuilder<infer Q>
                ? SolanaPortalData<Q>
                : never
          }
        : never

export function solanaPortalSource<Out extends SolanaOutputs>({
  portal,
  outputs,
  cache,
  logger,
  metrics,
  profiler,
  progress,
}: {
  portal: string | PortalClientOptions
  outputs: Out
  cache?: PortalCache
  metrics?: MetricsServer
  logger?: Logger | LogLevel
  profiler?: boolean | SpanHooks
  progress?: ProgressTrackerOptions
}) {
  type F = { block: { hash: true; number: true } }
  const query = new SolanaQueryBuilder<F>().addFields({
    block: { hash: true, number: true },
  })

  return new PortalSource<SolanaQueryBuilder<F>, SolanaPortalStream<Out>>({
    portal,
    query,
    cache,
    logger,
    metrics,
    profiler,
    transformers: [
      progressTracker({
        interval: progress?.interval,
        onStart: progress?.onStart,
        onProgress: progress?.onProgress,
      }),
      createTransformer<SolanaPortalData<F>, SolanaPortalData<F>>({
        profiler: { id: 'normalize data' },
        transform: (data, ctx) => {
          const schema = getBlockSchema<solana.Block<F>>(ctx.query.raw)

          return data.map((b) => cast(schema, b))
        },
      }),
      mergeOutputs(outputs),
    ],
  })
}
