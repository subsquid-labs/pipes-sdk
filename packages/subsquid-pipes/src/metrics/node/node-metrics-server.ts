import { Server } from 'http'

import express, { Application } from 'express'
import client from 'prom-client'

import { Logger, Metrics } from '~/core/index.js'
import {
  Counter,
  CounterConfiguration,
  Gauge,
  GaugeConfiguration,
  Histogram,
  HistogramConfiguration,
  MetricsServer,
  Summary,
  SummaryConfiguration,
} from '~/core/metrics-server.js'
import { BatchCtx } from '~/core/portal-source.js'
import { Profiler } from '~/core/profiling.js'
import { npmVersion } from '~/version.js'

export type MetricsServerOptions = {
  port?: number
  enabled?: boolean
  logger?: Logger
}

export type Stats = {
  sdk: {
    version: string
  }
  code: {
    filename: string
  }
  pipes: {
    id: string
    portal: {
      url: string
      query: any
    }
    progress: {
      from: number
      current: number
      to: number
      percent: number
      etaSeconds: number
    }
    speed: {
      blocksPerSecond: number
      bytesPerSecond: number
    }
  }[]

  usage: {
    memory: number
  }
}

function parseDate(date: any): Date | null {
  date = Array.isArray(date) ? date[0] : date

  if (typeof date !== 'string') {
    return null
  }

  const parsed = new Date(date)
  if (isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

type ProfilerResult = {
  name: string
  totalTime: number
  children: ProfilerResult[]
}

function transformProfiler(profiler: Profiler): ProfilerResult {
  return {
    name: profiler.name,
    totalTime: profiler.elapsed,
    children: profiler.children.map((c) => transformProfiler(c)),
  }
}

type TransformationResult = {
  name: string
  data: any
  children: TransformationResult[]
}

function transformExemplar(profiler: Profiler): TransformationResult {
  return {
    name: profiler.name,
    data: JSON.stringify(profiler.data, (k: string, v: any) => {
      if (typeof v === 'bigint') {
        return v.toString() + 'n'
      }
      if (v instanceof Date) {
        return v.toISOString()
      }

      return v
    }),
    children: profiler.children.map((c) => transformExemplar(c)),
  }
}

const MAX_HISTORY = 50
const DEFAULT_PORT = 9090

type PipeData = {
  lastBatch?: BatchCtx
  profilers: { profiler: ProfilerResult; collectedAt: Date }[]
  transformationExemplar?: TransformationResult
}

class ExpressMetricServer implements MetricsServer {
  readonly #options: { port: number; enabled: boolean }
  readonly #app: Application
  readonly #metrics: Metrics

  #started: boolean = false
  #server?: Server
  #logger?: Logger
  #pipes: Map<string, PipeData> = new Map()

  constructor({ port = DEFAULT_PORT, enabled = true, logger }: MetricsServerOptions = {}) {
    this.#options = {
      port,
      enabled,
    }
    this.#logger = logger

    const registry = new client.Registry()
    const metricsCache = new Map<string, any>()

    this.#app = express()

    this.#metrics = {
      counter<T extends string>(options: CounterConfiguration<T>): Counter<T> {
        const exits = metricsCache.get(options.name)
        if (exits) return exits

        const metric = new client.Counter(options)
        metricsCache.set(options.name, metric)
        registry.registerMetric(metric)

        return metric
      },

      gauge<T extends string>(options: GaugeConfiguration<T>): Gauge<T> {
        const exits = metricsCache.get(options.name)
        if (exits) return exits

        const metric = new client.Gauge(options)
        metricsCache.set(options.name, metric)
        registry.registerMetric(metric)

        return metric
      },

      histogram<T extends string>(options: HistogramConfiguration<T>): Histogram<T> {
        const exits = metricsCache.get(options.name)
        if (exits) return exits

        const metric = new client.Histogram(options)
        metricsCache.set(options.name, metric)
        registry.registerMetric(metric)

        return metric
      },

      summary<T extends string>(options: SummaryConfiguration<T>): Summary<T> {
        const exits = metricsCache.get(options.name)
        if (exits) return exits

        const metric = new client.Summary(options)
        metricsCache.set(options.name, metric)
        registry.registerMetric(metric)

        return metric
      },
    }

    this.#app.use((req, res, next): any => {
      const origin = req.headers.origin

      // Allow requests only from localhost
      if (origin && origin.includes('localhost')) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        res.setHeader('Access-Control-Allow-Credentials', 'true') // if needed
      }

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204) // No Content
      }

      next()
    })

    this.#app.get('/stats', async (req, res) => {
      const memory = await registry.getSingleMetric('process_resident_memory_bytes')?.get()

      const data: Stats = {
        sdk: {
          version: npmVersion,
        },
        usage: {
          memory: memory?.values?.[0]?.value || 0,
        },
        code: {
          filename: process.argv[1],
        },
        pipes: Array.from(this.#pipes.keys()).map((id) => {
          const pipeData = this.getPipe(id)
          const lastBatch = pipeData?.lastBatch

          return {
            id,
            portal: {
              url: lastBatch?.query.url || '',
              query: lastBatch?.query.raw || {},
            },
            progress: {
              from: lastBatch?.state.initial || 0,
              current: lastBatch?.state.current.number || 0,
              to: lastBatch?.state.last || 0,
              percent: lastBatch?.state.progress?.state.percent || 0,
              etaSeconds: lastBatch?.state.progress?.state.etaSeconds || 0,
            },
            speed: {
              blocksPerSecond: lastBatch?.state.progress?.interval.processedBlocks.perSecond || 0,
              bytesPerSecond: lastBatch?.state.progress?.interval.bytesDownloaded.perSecond || 0,
            },
          }
        }),
      }

      res.json({ payload: data })
    })

    this.#app.get('/profiler', async (req, res) => {
      const from = parseDate(req.query['from']) || new Date(0)
      const pipeData = this.getPipe(req.query['id'] as string | undefined)
      const profilers = pipeData?.profilers || []

      return res.json({
        // FIXME: remove hardcoded field
        payload: {
          enabled: true,
          profilers: profilers.filter((p) => p.collectedAt >= from).map((p) => p.profiler),
        },
      })
    })

    this.#app.get('/exemplars/transformation', async (req, res) => {
      const pipeData = this.getPipe(req.query['id'] as string | undefined)
      const transformationExemplar = pipeData?.transformationExemplar

      return res.json({
        payload: {
          transformation: transformationExemplar,
        },
      })
    })

    this.#app.get('/metrics', async (req, res) => {
      res.set('Content-Type', registry.contentType)
      res.end(await registry.metrics())
    })

    this.#app.get('/health', async (req, res) => {
      res.send('ok')
    })
  }

  async start() {
    if (!this.#options.enabled) return
    if (this.#started) return

    this.#started = true
    this.#server = this.#app.listen(this.#options.port, () => {
      this.#logger?.info(`🦑 Metrics server started at http://localhost:${this.#options.port}`)
    })
  }

  async stop() {
    this.#started = false
    client.register.clear()

    return new Promise<void>((done) => {
      if (!this.#server) return done()

      this.#server.close((_) => done())
    })
  }

  private getPipe(id?: string): PipeData | undefined {
    if (id) return this.#pipes.get(id)
    // Default to the first pipe for backward compatibility
    const first = this.#pipes.keys().next()
    return first.done ? undefined : this.#pipes.get(first.value)
  }

  registerPipe(id: string) {
    let data = this.#pipes.get(id)
    if (!data) {
      data = { profilers: [] }
      this.#pipes.set(id, data)
    }
    return data
  }

  batchProcessed(ctx: BatchCtx) {
    const data = this.registerPipe(ctx.id)

    data.lastBatch = ctx
    data.transformationExemplar = transformExemplar(ctx.profiler)

    data.profilers.push({
      profiler: transformProfiler(ctx.profiler),
      collectedAt: new Date(),
    })
    data.profilers = data.profilers.slice(-MAX_HISTORY)
  }

  get metrics() {
    return this.#metrics
  }

  setLogger(newLogger: Logger, override = false) {
    if (!override && this.#logger) return

    this.#logger = newLogger
  }
}

const servers = new Map<number, ExpressMetricServer>()

export function metricsServer(options: MetricsServerOptions = {}): MetricsServer {
  const port = options.port || DEFAULT_PORT

  const existed = servers.get(port)
  if (existed) return existed

  const server = new ExpressMetricServer(options)
  servers.set(port, server)

  return server
}
