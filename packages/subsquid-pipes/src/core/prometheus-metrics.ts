import express from 'express'
import { Server } from 'http'
import client, {
  Counter,
  CounterConfiguration,
  Gauge,
  GaugeConfiguration,
  Histogram,
  HistogramConfiguration,
} from 'prom-client'

// re-export types
export { Histogram, Counter, Gauge }

export type Metrics = {
  start(): void
  stop(): Promise<void>
  counter<T extends string>(options: CounterConfiguration<T>): Counter<T>
  gauge<T extends string>(options: GaugeConfiguration<T>): Gauge<T>
  histogram<T extends string>(options: HistogramConfiguration<T>): Histogram<T>
}

const metrics = new Map<string, any>()

export function createPrometheusMetrics(): Metrics {
  const registry = new client.Registry()
  const app = express()
  let server: Server | undefined = undefined

  client.collectDefaultMetrics({
    register: registry,
  })

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', registry.contentType)
    res.end(await registry.metrics())
  })

  app.get('/health', async (req, res) => {
    res.send('ok')
  })

  return {
    start: () => {
      server = app.listen(9090)
    },
    stop: async () => {
      client.register.clear()

      return new Promise((done) => {
        server?.close((_) => done())
      })
    },

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
  }
}
