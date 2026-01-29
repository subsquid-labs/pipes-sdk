import { cast } from '@subsquid/util-internal-validation'

import {
  LogLevel,
  Logger,
  PortalCache,
  PortalRange,
  PortalSource,
  Transformer,
  createDefaultLogger,
  createTransformer,
} from '~/core/index.js'
import { MetricsServer } from '~/core/metrics-server.js'
import { ProgressTrackerOptions, progressTracker } from '~/core/progress-tracker.js'

import { PortalClient, PortalClientOptions, evm, getBlockSchema } from '../portal-client/index.js'
import { EvmQueryBuilder } from './evm-query-builder.js'
import { RunnerCtx } from '~/runner/runner.js'

export type EvmTransformer<In, Out> = Transformer<In, Out, EvmQueryBuilder>

export type EvmPortalData<F extends evm.FieldSelection> = { blocks: evm.Block<F>[] }

export function evmPortalSource<F extends evm.FieldSelection = any>({
  portal,
  query,
  cache,
  logger,
  metrics,
  progress,
  runnerCtx,
}: {
  portal: string | PortalClientOptions | PortalClient
  query?: PortalRange | EvmQueryBuilder<F>
  cache?: PortalCache
  metrics?: MetricsServer
  logger?: Logger | LogLevel
  progress?: ProgressTrackerOptions
  runnerCtx?: RunnerCtx
}) {
  logger = logger && typeof logger !== 'string' ? logger : createDefaultLogger({ level: logger })

  return new PortalSource<EvmQueryBuilder<F>, EvmPortalData<F>>({
    portal,
    query: !query
      ? new EvmQueryBuilder<F>()
      : query instanceof EvmQueryBuilder
        ? query
        : new EvmQueryBuilder<F>().addRange(query),
    cache,
    logger,
    metrics,
    runnerCtx,
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

          data.blocks = data.blocks.map((b) => cast(schema, b))

          return data
        },
      }),
    ],
  })
}

/**
 *  @deprecated use `evmPortalSource` instead
 */
export const createEvmPortalSource = evmPortalSource
