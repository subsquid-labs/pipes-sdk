import { cast } from '@subsquid/util-internal-validation'

import {
  LogLevel,
  Logger,
  Outputs,
  PortalCache,
  PortalSource,
  Transformer,
  createDefaultLogger,
  createTransformer,
  mergeOutputs,
} from '~/core/index.js'
import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'

import { PortalClient, PortalClientOptions, getBlockSchema } from '../portal-client/index.js'
import * as evm from '../portal-client/query/evm.js'
import { EvmPortalData, EvmQueryBuilder } from './evm-query-builder.js'

export type EvmFieldSelection = evm.FieldSelection

export type EvmOutputs = Outputs<evm.FieldSelection, EvmQueryBuilder<any>>

type EvmPortalStream<T extends EvmOutputs> =
  T extends EvmQueryBuilder<infer Q>
    ? EvmPortalData<Q>
    : T extends Transformer<any, infer O>
      ? O
      : T extends Record<string, Transformer<any, any> | EvmQueryBuilder<any>>
        ? {
            [K in keyof T]: T[K] extends Transformer<any, infer O>
              ? O
              : T[K] extends EvmQueryBuilder<infer Q>
                ? EvmPortalData<Q>
                : never
          }
        : never

export function evmPortalSource<Out extends EvmOutputs>({
  portal,
  outputs,
  cache,
  logger,
  metrics,
  progress,
}: {
  portal: string | PortalClientOptions | PortalClient
  outputs: Out
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

  return new PortalSource<EvmQueryBuilder<F>, EvmPortalStream<Out>>({
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
          const schema = getBlockSchema<evm.Block<F>>(ctx.query.raw)

          return data.map((b) => cast(schema, b))
        },
      }),
      mergeOutputs(outputs),
    ],
  })
}
