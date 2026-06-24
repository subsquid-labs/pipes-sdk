import { describe, expect, it } from 'vitest'

import { MockGauge } from '~/testing/index.js'

import { registerFallbackMetrics } from './fallback-metrics.js'
import { FallbackMetrics } from './fallback-source.js'

describe('registerFallbackMetrics', () => {
  it('exports active source, per-source health, and switch count via collect', () => {
    const captured = new Map<string, { collect: (this: MockGauge) => void; gauge: MockGauge }>()
    const metrics: any = {
      gauge(config: any) {
        const gauge = new MockGauge()
        captured.set(config.name, { collect: config.collect, gauge })
        return gauge
      },
    }

    const snapshot: FallbackMetrics = {
      activeIndex: 1,
      switchCount: 2,
      sources: [
        { name: 'portal', health: 'unhealthy', active: false },
        { name: 'rpc', health: 'unknown', active: true },
      ],
    }
    registerFallbackMetrics(metrics, { metrics: () => snapshot })

    // Drive each gauge's scrape-time collect callback.
    for (const { collect, gauge } of captured.values()) collect.call(gauge)

    expect(captured.get('sqd_fallback_active')!.gauge.calls).toEqual([
      { labels: { source: 'portal' }, value: 0 },
      { labels: { source: 'rpc' }, value: 1 },
    ])

    const health = captured.get('sqd_fallback_source_health')!.gauge
    expect(health.calls).toContainEqual({ labels: { source: 'portal', state: 'unhealthy' }, value: 1 })
    expect(health.calls).toContainEqual({ labels: { source: 'portal', state: 'healthy' }, value: 0 })
    expect(health.calls).toContainEqual({ labels: { source: 'rpc', state: 'unknown' }, value: 1 })

    expect(captured.get('sqd_fallback_switches_total')!.gauge.calls).toEqual([{ value: 2 }])
  })
})
