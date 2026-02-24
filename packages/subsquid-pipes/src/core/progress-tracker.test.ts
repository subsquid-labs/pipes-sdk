import { afterEach, describe, expect, it } from 'vitest'

import { evmQuery } from '~/evm/evm-query-builder.js'
import { evmPortalSource } from '~/evm/index.js'
import { MockPortal, closeMockPortal, createMockMetricServer, createMockPortal } from '~/tests/index.js'

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

    const metrics = createMockMetricServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 3 }),
      metrics: metrics.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    expect(metrics.gauge('sqd_current_block')).toBeDefined()
    expect(metrics.gauge('sqd_last_block')).toBeDefined()
    expect(metrics.gauge('sqd_progress_ratio')).toBeDefined()
    expect(metrics.gauge('sqd_eta_seconds')).toBeDefined()
    expect(metrics.gauge('sqd_blocks_per_second')).toBeDefined()
    expect(metrics.counter('sqd_bytes_downloaded_total')).toBeDefined()
  })

  it('should register all expected portal-source metrics', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
      },
    ])

    const metrics = createMockMetricServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 1 }),
      metrics: metrics.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    expect(metrics.counter('sqd_forks_total')).toBeDefined()
    expect(metrics.counter('sqd_portal_requests_total')).toBeDefined()
    expect(metrics.histogram('sqd_batch_size_blocks')).toBeDefined()
    expect(metrics.histogram('sqd_batch_size_bytes')).toBeDefined()
  })

  it('should track portal request counts with classification and status labels', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x1', timestamp: 1000 } },
          { header: { number: 2, hash: '0x2', timestamp: 2000 } },
        ],
      },
    ])

    const metrics = createMockMetricServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 2 }),
      metrics: metrics.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    const requests = metrics.counter('sqd_portal_requests_total')
    expect(requests).toBeDefined()
    expect(requests.total).toBeGreaterThan(0)

    // All requests should have classification=success and status=200
    for (const call of requests.calls) {
      expect(call.labels?.['classification']).toBe('success')
      expect(call.labels?.['status']).toBe('200')
    }
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

    const metrics = createMockMetricServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 3 }),
      metrics: metrics.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    expect(metrics.gauge('sqd_current_block').lastValue).toBe(3)
    expect(metrics.gauge('sqd_last_block').lastValue).toBe(3)
    expect(metrics.gauge('sqd_progress_ratio').lastValue).toBe(1)
    expect(metrics.gauge('sqd_eta_seconds').lastValue).toBe(0)
    expect(metrics.gauge('sqd_blocks_per_second').lastValue).toBeGreaterThanOrEqual(0)
    expect(metrics.counter('sqd_bytes_downloaded_total').total).toBeGreaterThan(0)
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

    const metrics = createMockMetricServer()

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: blockOutputs({ from: 0, to: 3 }),
      metrics: metrics.server,
    })

    for await (const _batch of stream) {
      // consume
    }

    const batchBlocks = metrics.histogram('sqd_batch_size_blocks')
    expect(batchBlocks.observations.length).toBeGreaterThanOrEqual(1)
    const totalBlocks = batchBlocks.observations.reduce((sum, n) => sum + n, 0)
    expect(totalBlocks).toBe(3)

    const batchBytes = metrics.histogram('sqd_batch_size_bytes')
    expect(batchBytes.observations.length).toBe(batchBlocks.observations.length)
    for (const obs of batchBytes.observations) {
      expect(obs).toBeGreaterThan(0)
    }
  })
})
