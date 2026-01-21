import { cast } from '@subsquid/util-internal-validation'

import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'

import {
  LogLevel,
  Logger,
  PortalCache,
  PortalSource,
  Streams,
  Transformer,
  createDefaultLogger,
  createTransformer,
  mergeStreams,
} from '../core/index.js'
import { PortalClientOptions, getBlockSchema, solana } from '../portal-client/index.js'
import { SolanaQueryBuilder } from './solana-query-builder.js'

export type SolanaFieldSelection = solana.FieldSelection

export type SolanaPortalData<F extends solana.FieldSelection> = solana.Block<F>[]

type SolanaStreams = Streams<solana.FieldSelection, SolanaQueryBuilder>

type SolanaPortalStream<T extends SolanaStreams> = T extends SolanaQueryBuilder<infer Q>
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

export function solanaPortalSource<S extends SolanaStreams>({
  portal,
  streams,
  cache,
  logger,
  metrics,
  progress,
}: {
  portal: string | PortalClientOptions
  streams: S
  cache?: PortalCache
  metrics?: MetricsServer
  logger?: Logger | LogLevel
  progress?: ProgressTrackerOptions
}) {
  logger = logger && typeof logger !== 'string' ? logger : createDefaultLogger({ level: logger })

  type F = { block: { hash: true; number: true } }
  const query = new SolanaQueryBuilder<F>().addFields({
    block: { hash: true, number: true },
  })

  return new PortalSource<SolanaQueryBuilder<F>, SolanaPortalStream<S>>({
    portal,
    query,
    cache,
    logger,
    metrics,
    transformers: [
      progressTracker({
        logger,
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
      mergeStreams(streams),
    ],
  })
}
