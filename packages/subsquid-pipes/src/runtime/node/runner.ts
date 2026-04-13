import { Logger, createDefaultLogger } from '~/core/logger.js'
import { MetricsServer, noopMetricsServer } from '~/core/metrics-server.js'
import { MetricsServerOptions, metricsServer } from '~/metrics/node/index.js'

import { RuntimeContext, runWithContext } from './context.js'

type Config = {
  /**
   * Maximum number of restart attempts per pipe before the runner gives up and
   * re-throws the error. Defaults to `5`.
   */
  retry?: number
  /**
   * When provided, starts a Prometheus metrics server shared by all pipes.
   */
  metrics?: MetricsServerOptions
}

type SerializableObject = Record<string, string | number | Date | boolean>

/**
 * Context passed to each pipe's `stream` function at runtime.
 */
export type RunConfig<T extends SerializableObject> = {
  /** Stable ID for this pipe, used for cursor persistence and log prefixing. */
  id: string
  /** Params supplied in the pipe declaration. */
  params: T
  /** Shared metrics server. */
  metrics: MetricsServer
  /** Logger scoped to this pipe's ID. */
  logger: Logger
}

type StreamConfig<T extends SerializableObject> = {
  /** Stable, unique identifier for this pipe. */
  id: string
  /** Arbitrary params forwarded to the `stream` function. */
  params: T
  /** Async function that runs the pipe to completion. */
  stream: string | ((ctx: RunConfig<T>) => Promise<unknown>)
}

class Runner<T extends SerializableObject = any> {
  readonly #logger: Logger

  constructor(
    private pipes: StreamConfig<T>[],
    private config: Config = {},
  ) {
    this.#logger = createDefaultLogger()
  }

  async start() {
    const metrics = this.config.metrics
      ? metricsServer({
          logger: this.#logger,
          ...this.config.metrics,
        })
      : noopMetricsServer()

    await Promise.all(
      this.pipes.map(async (pipe) => {
        const stream = pipe.stream

        const maxAttempts = this.config.retry || 5
        let attempts = 0

        const logger = this.#logger.child({ id: pipe.id })
        const ctx: RuntimeContext = {
          id: pipe.id,
          logger,
          metrics,
        }

        while (true) {
          try {
            if (typeof stream === 'function') {
              await runWithContext(ctx, async () => {
                await stream({
                  id: pipe.id,
                  params: pipe.params,
                  metrics,
                  logger,
                })
              })
            } else {
              const worker = new Worker(new URL('worker.ts', import.meta.url).href, {
                env: {
                  ...process.env,
                  PORT: '3333',
                },
              })

              await new Promise<void>((resolve, reject) =>
                worker.addEventListener('close', (event) => {
                  if (event.code !== 0) {
                    reject(new Error(`Worker stopped with exit code ${event.code}`))
                  }

                  resolve()
                }),
              )
            }

            return
          } catch (e) {
            if (e instanceof Error && e.message === 'not implemented') {
              throw e
            } else if (++attempts >= maxAttempts) {
              throw e
            } else {
              logger.error({
                message: `Error while running pipe, restarting...`,
                error: e,
              })
            }
          }
        }
      }),
    )
  }
}

/**
 * **For local development only.**
 *
 * Runs multiple pipes concurrently inside a single Node.js process.
 *
 * **Why not for production:**
 * - **Single-threaded.** All pipes share one JS thread. A CPU-intensive pipe
 *   will starve its neighbours. Worker-thread support is planned for a future
 *   release.
 * - **Shared fate.** If the process crashes, every pipe goes down together.
 *   The runner retries the *individual* pipe that threw, but an OS-level kill
 *   or an unhandled rejection that escapes the retry loop takes everything
 *   with it.
 *
 * For production, run each pipe as a separate process or container so
 * failures stay isolated and resources can be scaled independently.
 *
 * @example
 * ```ts
 * import { createDevRunner } from '@subsquid/pipes/runtime/node'
 *
 * const runner = createDevRunner([
 *   {
 *     id: 'transfers',
 *     params: { portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet' },
 *     stream: async ({ id, params, logger, metrics }) => {
 *       const stream = evmPortalSource({ id, portal: params.portal, outputs: evmDecoder({ ... }) })
 *       for await (const { data } of stream) { ... }
 *     },
 *   },
 * ], { retry: 5, metrics: { port: 9090 } })
 *
 * await runner.start()
 * ```
 */
export function createDevRunner<T extends SerializableObject>(streams: StreamConfig<T>[], defaultConfig?: Config) {
  return new Runner(streams, defaultConfig)
}
