import { afterEach, describe, expect, it } from 'vitest'

import { evmPortalSource } from '~/evm/index.js'
import { MockPortal, blockTransformer, closeMockPortal, createMockPortal } from '~/tests/index.js'
import { BatchCtx } from './portal-source.js'
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

  const server: MetricsServer = {
    start() {},
    async stop() {},
    addBatchContext(_ctx: BatchCtx) {},
    metrics: {
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

describe('Pipeline metrics', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  it('should update progress-tracker metrics on batch processing', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x1' } },
          { header: { number: 2, hash: '0x2' } },
          { header: { number: 3, hash: '0x3' } },
        ],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      query: { from: 0, to: 3 },
      metrics: tracking.server,
    }).pipe(blockTransformer())

    for await (const _batch of stream) {
      // consume stream
    }

    // sqd_current_block should be set to last processed block
    const currentBlock = tracking.get<TrackingGauge>('sqd_current_block')
    expect(currentBlock).toBeDefined()
    expect(currentBlock.lastValue).toBe(3)

    // sqd_last_block should reflect the last block number
    const lastBlock = tracking.get<TrackingGauge>('sqd_last_block')
    expect(lastBlock).toBeDefined()
    expect(lastBlock.lastValue).toBe(3)

    // sqd_progress_ratio should be 1.0 (100% complete)
    const progressRatio = tracking.get<TrackingGauge>('sqd_progress_ratio')
    expect(progressRatio).toBeDefined()
    expect(progressRatio.lastValue).toBe(1)

    // sqd_eta_seconds should be 0 (fully synced)
    const eta = tracking.get<TrackingGauge>('sqd_eta_seconds')
    expect(eta).toBeDefined()
    expect(eta.lastValue).toBe(0)

    // sqd_blocks_per_second should be defined
    const bps = tracking.get<TrackingGauge>('sqd_blocks_per_second')
    expect(bps).toBeDefined()
    expect(bps.lastValue).toBeGreaterThanOrEqual(0)

    // sqd_bytes_downloaded_total should have been incremented
    const bytesDownloaded = tracking.get<TrackingCounter>('sqd_bytes_downloaded_total')
    expect(bytesDownloaded).toBeDefined()
    expect(bytesDownloaded.total).toBeGreaterThan(0)
  })

  it('should track portal request statuses', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1' } }],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      query: { from: 0, to: 1 },
      metrics: tracking.server,
    }).pipe(blockTransformer())

    for await (const _batch of stream) {
      // consume stream
    }

    const portalRequests = tracking.get<TrackingCounter>('sqd_portal_requests_total')
    expect(portalRequests).toBeDefined()
    expect(portalRequests.total).toBeGreaterThan(0)

    // All requests should be successful (status label = 'success')
    const successCalls = portalRequests.calls.filter((c) => c.labels?.['status'] === 'success')
    expect(successCalls.length).toBeGreaterThan(0)
  })

  it('should update portal-source batch metrics', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x1' } },
          { header: { number: 2, hash: '0x2' } },
          { header: { number: 3, hash: '0x3' } },
        ],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      query: { from: 0, to: 3 },
      metrics: tracking.server,
    }).pipe(blockTransformer())

    for await (const _batch of stream) {
      // consume stream
    }

    // sqd_batch_size_blocks should have at least 1 observation
    const batchBlocks = tracking.get<TrackingHistogram>('sqd_batch_size_blocks')
    expect(batchBlocks).toBeDefined()
    expect(batchBlocks.observations.length).toBeGreaterThanOrEqual(1)
    // Total blocks across all batches should be 3
    const totalBlocks = batchBlocks.observations.reduce((sum, n) => sum + n, 0)
    expect(totalBlocks).toBe(3)

    // sqd_batch_size_bytes should have matching observations
    const batchBytes = tracking.get<TrackingHistogram>('sqd_batch_size_bytes')
    expect(batchBytes).toBeDefined()
    expect(batchBytes.observations.length).toBe(batchBlocks.observations.length)
    for (const obs of batchBytes.observations) {
      expect(obs).toBeGreaterThan(0)
    }
  })

  it('should set pipeline running gauge to 1 during execution and 0 after stop', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1' } }],
      },
    ])

    const tracking = createTrackingMetricsServer()

    let runningDuringExecution: number | undefined

    const stream = evmPortalSource({
      portal: mockPortal.url,
      query: { from: 0, to: 1 },
      metrics: tracking.server,
    }).pipe((data) => {
      const gauge = tracking.get<TrackingGauge>('sqd_pipeline_running')
      runningDuringExecution = gauge?.lastValue
      return data
    })

    for await (const _batch of stream) {
      // consume stream
    }

    expect(runningDuringExecution).toBe(1)

    // After stream completes, pipeline_running should be set to 0
    const pipelineRunning = tracking.get<TrackingGauge>('sqd_pipeline_running')
    expect(pipelineRunning.lastValue).toBe(0)
  })

  it('should handle multiple batches accumulating bytes counter', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x1' } },
          { header: { number: 2, hash: '0x2' } },
          { header: { number: 3, hash: '0x3' } },
        ],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      query: { from: 0, to: 3 },
      metrics: tracking.server,
    }).pipe(blockTransformer())

    for await (const _batch of stream) {
      // consume stream
    }

    // bytes_downloaded should have been incremented at least once
    const bytesDownloaded = tracking.get<TrackingCounter>('sqd_bytes_downloaded_total')
    expect(bytesDownloaded).toBeDefined()
    expect(bytesDownloaded.calls.length).toBeGreaterThanOrEqual(1)
    expect(bytesDownloaded.total).toBeGreaterThan(0)
  })

  it('should track request status labels for rate-limited and server errors', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1' } }],
      },
      // 503 retries, then success
      { statusCode: 503 },
      { statusCode: 503 },
      {
        statusCode: 200,
        data: [{ header: { number: 2, hash: '0x2' } }],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: {
        url: mockPortal.url,
        http: { retrySchedule: [0] },
      },
      query: { from: 0, to: 2 },
      metrics: tracking.server,
    }).pipe(blockTransformer())

    for await (const _batch of stream) {
      // consume stream
    }

    const portalRequests = tracking.get<TrackingCounter>('sqd_portal_requests_total')
    expect(portalRequests).toBeDefined()

    // Should have success and server_error calls
    const successCalls = portalRequests.calls.filter((c) => c.labels?.['status'] === 'success')
    const serverErrorCalls = portalRequests.calls.filter((c) => c.labels?.['status'] === 'server_error')

    expect(successCalls.length).toBeGreaterThan(0)
    expect(serverErrorCalls.length).toBeGreaterThan(0)
  })

  it('should create all expected metrics', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1' } }],
      },
    ])

    const tracking = createTrackingMetricsServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      query: { from: 0, to: 1 },
      metrics: tracking.server,
    }).pipe(blockTransformer())

    for await (const _batch of stream) {
      // consume stream
    }

    // Progress tracker metrics
    expect(tracking.get('sqd_current_block')).toBeDefined()
    expect(tracking.get('sqd_last_block')).toBeDefined()
    expect(tracking.get('sqd_progress_ratio')).toBeDefined()
    expect(tracking.get('sqd_eta_seconds')).toBeDefined()
    expect(tracking.get('sqd_blocks_per_second')).toBeDefined()
    expect(tracking.get('sqd_bytes_downloaded_total')).toBeDefined()
    expect(tracking.get('sqd_portal_requests_total')).toBeDefined()

    // Portal source metrics
    expect(tracking.get('sqd_pipeline_running')).toBeDefined()
    expect(tracking.get('sqd_reorgs_total')).toBeDefined()
    expect(tracking.get('sqd_batch_size_blocks')).toBeDefined()
    expect(tracking.get('sqd_batch_size_bytes')).toBeDefined()
  })
})
