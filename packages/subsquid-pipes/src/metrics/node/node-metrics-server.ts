import express from 'express'
import { Server } from 'http'
import client from 'prom-client'
import { Logger } from '~/core/index.js'
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

const metrics = new Map<string, any>()

export type Stats = {
  sdk: {
    version: string
  }
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

export function metricsServer({ port = 9090, enabled = true, logger }: MetricsServerOptions = {}): MetricsServer {
  const registry = new client.Registry()
  const app = express()
  let server: Server | undefined = undefined
  let isRunning = false

  client.collectDefaultMetrics({
    register: registry,
  })

  app.use((req, res, next): any => {
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

  let lastBatch: BatchCtx | null = null
  let profilers: { profiler: ProfilerResult; collectedAt: Date }[] = []
  let transformationExemplar: TransformationResult

  app.get('/stats', async (req, res) => {
    const memory = await registry.getSingleMetric('process_resident_memory_bytes')?.get()

    const data: Stats = {
      sdk: {
        version: npmVersion,
      },
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
      usage: {
        memory: memory?.values?.[0]?.value || 0,
      },
    }

    res.json({ payload: data })
  })

  app.get('/profiler', async (req, res) => {
    const from = parseDate(req.query['from']) || new Date(0)

    return res.json({
      // FIXME: remove hardcoded field
      payload: {
        enabled: true,
        profilers: profilers.filter((p) => p.collectedAt >= from).map((p) => p.profiler),
      },
    })
  })

  app.get('/exemplars/transformation', async (req, res) => {
    return res.json({
      payload: {
        transformation: transformationExemplar,
      },
    })
  })

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', registry.contentType)
    res.end(await registry.metrics())
  })

  app.get('/health', async (req, res) => {
    res.send('ok')
  })

  return {
    setLogger: (newLogger: Logger, override = false) => {
      if (!override && logger) return

      logger = newLogger
    },

    start: async () => {
      if (isRunning) return
      if (!enabled) return

      server = app.listen(port)
      isRunning = true

      logger?.info(`🦑 Metrics server started at http://localhost:${port}`)
    },

    stop: async () => {
      client.register.clear()

      return new Promise((done) => {
        if (!server) return done()

        server.close((_) => done())
        isRunning = false
      })
    },

    isRunning: async () => {
      return isRunning
    },

    addBatchContext(ctx: BatchCtx) {
      lastBatch = ctx

      transformationExemplar = transformExemplar(ctx.profiler)

      profilers.push({
        profiler: transformProfiler(ctx.profiler),
        collectedAt: new Date(),
      })

      profilers = profilers.slice(-MAX_HISTORY)
    },

    metrics: {
      counter<T extends string>(options: CounterConfiguration<T>): Counter<T> {
        const exits = metrics.get(options.name)
        if (exits) {
          return exits
        }

        const metric = new client.Counter(options)
        metrics.set(options.name, metric)
        registry.registerMetric(metric)

        return metric
      },

      gauge<T extends string>(options: GaugeConfiguration<T>): Gauge<T> {
        const exits = metrics.get(options.name)
        if (exits) {
          return exits as Gauge<T>
        }

        const metric = new client.Gauge(options)
        metrics.set(options.name, metric)
        registry.registerMetric(metric)

        return metric
      },

      histogram<T extends string>(options: HistogramConfiguration<T>): Histogram<T> {
        const exits = metrics.get(options.name)
        if (exits) {
          return exits as Histogram<T>
        }

        const metric = new client.Histogram(options)
        metrics.set(options.name, metric)
        registry.registerMetric(metric)

        return metric
      },

      summary<T extends string>(options: SummaryConfiguration<T>): Summary<T> {
        const exits = metrics.get(options.name)
        if (exits) {
          return exits as Summary<T>
        }

        const metric = new client.Summary(options)
        metrics.set(options.name, metric)
        registry.registerMetric(metric)

        return metric
      },
    },
  }
}

/**
 *  @deprecated Use `metricsServer` instead.
 */
export const createNodeMetricsServer = metricsServer
