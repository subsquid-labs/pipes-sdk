import { Logger, createDefaultLogger } from '~/core/logger.js'
import { MetricsServer, noopMetricsServer } from '~/core/metrics-server.js'
import { MetricsServerOptions, metricsServer } from '~/metrics/node/index.js'

import { RuntimeContext, runWithContext } from './context.js'

type Config = {
  retry?: number
  metrics?: MetricsServerOptions
}

type SerializableObject = Record<string, string | number | Date | boolean>

export type RunConfig<T extends SerializableObject> = {
  id: string
  params: T
  metrics: MetricsServer
  logger: Logger
}

type StreamConfig<T extends SerializableObject> = {
  id: string
  params: T
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

export function createRunner<T extends SerializableObject>(streams: StreamConfig<T>[], defaultConfig?: Config) {
  return new Runner(streams, defaultConfig)
}
