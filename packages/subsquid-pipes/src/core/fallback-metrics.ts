import { FallbackMetrics } from './fallback-source.js'
import { Metrics } from './metrics-server.js'

export interface FallbackMetricsSource {
  metrics(): FallbackMetrics
}

const HEALTH_STATES = ['healthy', 'unhealthy', 'unknown'] as const

/**
 * Register pull-based gauges that export a {@link FallbackSource}'s observable state on a metrics
 * surface (§4 — "unhealthiness reflected in metrics"): which source is active, each source's
 * trinary health, and the cumulative switch count. The gauges read `source.metrics()` on every
 * scrape via the prom-style `collect` callback, so there is nothing to push.
 */
export function registerFallbackMetrics(
  metrics: Metrics,
  source: FallbackMetricsSource,
  prefix = 'sqd_fallback',
): void {
  metrics.gauge<'source'>({
    name: `${prefix}_active`,
    help: 'Currently active fallback source (1 = active, 0 = standby)',
    labelNames: ['source'],
    collect() {
      for (const s of source.metrics().sources) {
        this.set({ source: s.name }, s.active ? 1 : 0)
      }
    },
  })

  metrics.gauge<'source' | 'state'>({
    name: `${prefix}_source_health`,
    help: 'Per-source trinary health (1 for the current state, 0 otherwise)',
    labelNames: ['source', 'state'],
    collect() {
      for (const s of source.metrics().sources) {
        for (const state of HEALTH_STATES) {
          this.set({ source: s.name, state }, s.health === state ? 1 : 0)
        }
      }
    },
  })

  metrics.gauge({
    name: `${prefix}_switches_total`,
    help: 'Cumulative number of fallback source switches',
    collect() {
      this.set(source.metrics().switchCount)
    },
  })
}
