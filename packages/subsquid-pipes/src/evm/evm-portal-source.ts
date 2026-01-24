import { cast } from '@subsquid/util-internal-validation'

import {
  Decoder,
  LogLevel,
  Logger,
  PortalCache,
  PortalSource,
  Streams,
  createDefaultLogger,
  createTransformer,
  mergeStreams,
} from '~/core/index.js'
import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'

import { PortalClient, PortalClientOptions, evm as api, getBlockSchema } from '../portal-client/index.js'
import { EvmQueryBuilder } from './evm-query-builder.js'

export type EvmFieldSelection = api.FieldSelection

export type EvmPortalData<F extends api.FieldSelection> = api.Block<F>[]

export type EvmStreams = Streams<api.FieldSelection, EvmQueryBuilder>

type EvmPortalStream<T extends EvmStreams> =
  T extends EvmQueryBuilder<infer Q>
    ? EvmPortalData<Q>
    : T extends Decoder<any, infer O, any>
      ? O
      : T extends Record<string, Decoder<any, any, any> | EvmQueryBuilder<any>>
        ? {
            [K in keyof T]: T[K] extends Decoder<any, infer O, any>
              ? O
              : T[K] extends EvmQueryBuilder<infer Q>
                ? EvmPortalData<Q>
                : never
          }
        : never

export function evmPortalSource<S extends EvmStreams>({
  portal,
  streams,
  cache,
  logger,
  metrics,
  progress,
}: {
  portal: string | PortalClientOptions | PortalClient
  streams: S
  cache?: PortalCache
  metrics?: MetricsServer
  logger?: Logger | LogLevel
  progress?: ProgressTrackerOptions
}) {
  logger = logger && typeof logger !== 'string' ? logger : createDefaultLogger({ level: logger })

  type F = { block: { hash: true; number: true } }
  const query = new EvmQueryBuilder<F>().addFields({
    block: { hash: true, number: true },
  })

  return new PortalSource<EvmQueryBuilder<F>, EvmPortalStream<S>>({
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
      createTransformer<EvmPortalData<F>, EvmPortalData<F>>({
        profiler: { id: 'normalize data' },
        transform: (data, ctx) => {
          const schema = getBlockSchema<api.Block<F>>(ctx.query.raw)

          return data.map((b) => cast(schema, b))
        },
      }),
      mergeStreams(streams),
    ],
  })
}
