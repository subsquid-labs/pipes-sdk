import { afterEach, describe, expect, it } from 'vitest'

import { evmPortalSource } from '~/evm/index.js'
import { evmQuery } from '~/evm/evm-query-builder.js'
import { MockPortal, closeMockPortal, createMockPortal } from '~/tests/index.js'
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
} from './metrics-server.js'
import { BatchCtx } from './portal-source.js'

type MetricCall = { labels?: Record<string, string | number>; value: number }

class TrackingCounter<T extends string = string> implements Counter<T> {
  calls: MetricCall[] = []

  inc(labelsOrValue?: any, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.calls.push({ value: labelsOrValue })
    } else {
      this.calls.push({ labels: labelsOrValue, value: value! })
    }
  }

  get total(): number {
    return this.calls.reduce((sum, c) => sum + c.value, 0)
  }
}

class TrackingGauge<T extends string = string> implements Gauge<T> {
  calls: MetricCall[] = []

  set(labelsOrValue?: any, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.calls.push({ value: labelsOrValue })
    } else {
      this.calls.push({ labels: labelsOrValue, value: value! })
    }
  }

  get lastValue(): number | undefined {
    return this.calls[this.calls.length - 1]?.value
  }
}

class TrackingHistogram<T extends string = string> implements Histogram<T> {
  observations: number[] = []

  observe(value: number): void {
    this.observations.push(value)
  }
}

class TrackingSummary<T extends string = string> implements Summary<T> {
  observations: MetricCall[] = []

  observe(labelsOrValue?: any, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.observations.push({ value: labelsOrValue })
    } else {
      this.observations.push({ labels: labelsOrValue, value: value! })
    }
  }
}

function createTrackingMetricsServer() {
  const registered = new Map<string, any>()

  const metricsObj = {
    counter<T extends string>(options: CounterConfiguration<T>): Counter<T> {
      const existing = registered.get(options.name)
      if (existing) return existing
      const metric = new TrackingCounter<T>()
      registered.set(options.name, metric)
      return metric
    },
    gauge<T extends string>(options: GaugeConfiguration<T>): Gauge<T> {
      const existing = registered.get(options.name)
      if (existing) return existing
      const metric = new TrackingGauge<T>()
      registered.set(options.name, metric)
      return metric
    },
    histogram<T extends string>(options: HistogramConfiguration<T>): Histogram<T> {
      const existing = registered.get(options.name)
      if (existing) return existing
      const metric = new TrackingHistogram<T>()
      registered.set(options.name, metric)
      return metric
    },
    summary<T extends string>(options: SummaryConfiguration<T>): Summary<T> {
      const existing = registered.get(options.name)
      if (existing) return existing
      const metric = new TrackingSummary<T>()
      registered.set(options.name, metric)
      return metric
    },
  }

  const server: MetricsServer = {
    start() {},
    async stop() {},
    registerPipe() {},
    batchProcessed(_ctx: BatchCtx) {},
    metrics() {
      return metricsObj
    },
  }

  return {
    server,
    get<T = any>(name: string): T {
      return registered.get(name) as T
    },
    keys(): string[] {
      return [...registered.keys()]
    },
  }
}

function blockOutputs(range: { from: number; to: number }) {
  return evmQuery()
    .addFields({ block: { number: true, hash: true, timestamp: true } })
    .addRange(range)
}

describe('Pipeline metrics', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  it('should register all expected progress-tracker metrics', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x1', timestamp: 1000 } },
          { header: { number: 2, hash: '0x2', timestamp: 2000 } },
          { header: { number: 3, hash: '0x3', timestamp: 3000 } },
        ],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 3 }),
      metrics: tracking.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    expect(tracking.get('sqd_current_block')).toBeDefined()
    expect(tracking.get('sqd_last_block')).toBeDefined()
    expect(tracking.get('sqd_progress_ratio')).toBeDefined()
    expect(tracking.get('sqd_eta_seconds')).toBeDefined()
    expect(tracking.get('sqd_blocks_per_second')).toBeDefined()
    expect(tracking.get('sqd_bytes_downloaded_total')).toBeDefined()
    expect(tracking.get('sqd_pipeline_running')).toBeDefined()
  })

  it('should register all expected portal-source metrics', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 1 }),
      metrics: tracking.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    expect(tracking.get('sqd_reorgs_total')).toBeDefined()
    expect(tracking.get('sqd_batch_size_blocks')).toBeDefined()
    expect(tracking.get('sqd_batch_size_bytes')).toBeDefined()
  })

  it('should update progress-tracker metrics on batch processing', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x1', timestamp: 1000 } },
          { header: { number: 2, hash: '0x2', timestamp: 2000 } },
          { header: { number: 3, hash: '0x3', timestamp: 3000 } },
        ],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 3 }),
      metrics: tracking.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    const currentBlock = tracking.get<TrackingGauge>('sqd_current_block')
    expect(currentBlock.lastValue).toBe(3)

    const lastBlock = tracking.get<TrackingGauge>('sqd_last_block')
    expect(lastBlock.lastValue).toBe(3)

    const progressRatio = tracking.get<TrackingGauge>('sqd_progress_ratio')
    expect(progressRatio.lastValue).toBe(1)

    const eta = tracking.get<TrackingGauge>('sqd_eta_seconds')
    expect(eta.lastValue).toBe(0)

    const bps = tracking.get<TrackingGauge>('sqd_blocks_per_second')
    expect(bps.lastValue).toBeGreaterThanOrEqual(0)

    const bytesDownloaded = tracking.get<TrackingCounter>('sqd_bytes_downloaded_total')
    expect(bytesDownloaded.total).toBeGreaterThan(0)
  })

  it('should set pipeline running to 1 during execution and 0 after stop', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
      },
    ])

    const tracking = createTrackingMetricsServer()

    let runningDuringExecution: number | undefined

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 1 }),
      metrics: tracking.server,
    })

    for await (const _batch of stream) {
      const gauge = tracking.get<TrackingGauge>('sqd_pipeline_running')
      runningDuringExecution = gauge?.lastValue
    }

    expect(runningDuringExecution).toBe(1)

    const pipelineRunning = tracking.get<TrackingGauge>('sqd_pipeline_running')
    expect(pipelineRunning.lastValue).toBe(0)
  })

  it('should observe batch size metrics', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x1', timestamp: 1000 } },
          { header: { number: 2, hash: '0x2', timestamp: 2000 } },
          { header: { number: 3, hash: '0x3', timestamp: 3000 } },
        ],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 3 }),
      metrics: tracking.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    const batchBlocks = tracking.get<TrackingHistogram>('sqd_batch_size_blocks')
    expect(batchBlocks.observations.length).toBeGreaterThanOrEqual(1)
    const totalBlocks = batchBlocks.observations.reduce((sum, n) => sum + n, 0)
    expect(totalBlocks).toBe(3)

    const batchBytes = tracking.get<TrackingHistogram>('sqd_batch_size_bytes')
    expect(batchBytes.observations.length).toBe(batchBlocks.observations.length)
    for (const obs of batchBytes.observations) {
      expect(obs).toBeGreaterThan(0)
    }
  })
})
