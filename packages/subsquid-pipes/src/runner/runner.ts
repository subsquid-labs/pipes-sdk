import { AsyncLocalStorage } from 'async_hooks'

import { Logger, createDefaultLogger } from '~/core/logger.js'
import { MetricsServer } from '~/core/metrics-server.js'

class NotImplementedError extends Error {}

export type RunnerCtx = {
  id: string
}

type Config = {
  retry?: number
  metrics?: MetricsServer
}

type SerializableObject = Record<string, string | number | Date | boolean>

export type RunConfig<T extends SerializableObject> = {
  id: string
  params: T
  logger: Logger
  metrics?: MetricsServer
  runnerCtx?: RunnerCtx
}

type StreamConfig<T extends SerializableObject> = {
  id: string
  params: T
  stream: string | ((ctx: RunConfig<T>) => Promise<unknown>)
}

class Runner<T extends SerializableObject = any> {
  #logger: Logger

  constructor(
    private pipes: StreamConfig<T>[],
    private config: Config = {},
  ) {
    this.#logger = createDefaultLogger()
  }

  async start() {
    if (this.config.metrics?.setLogger) {
      this.config.metrics.setLogger(this.#logger, true)
    }

    const promises = this.pipes.map(async (pipe) => {
      const stream = pipe.stream

      const maxAttempts = this.config.retry || 5
      let attempts = 0

      const pipeLogger = this.#logger.child({ pipe_id: pipe.id })

      while (true) {
        try {
          if (typeof stream === 'function') {
            await stream({
              id: pipe.id,
              params: pipe.params,
              logger: pipeLogger,
              metrics: this.config.metrics,
              runnerCtx: { id: pipe.id },
            })
          } else {
            throw new NotImplementedError()
          }

          return
        } catch (e) {
          if (e instanceof NotImplementedError) {
            throw e
          } else if (++attempts >= maxAttempts) {
            throw e
          } else {
            pipeLogger.error({
              message: `Error while running pipe, restarting...`,
              error: e,
            })
          }
        }
      }
    })

    await Promise.all(promises)
  }
}

export function createRunner<T extends SerializableObject>(streams: StreamConfig<T>[], defaultConfig?: Config) {
  return new Runner(streams, defaultConfig)
}
