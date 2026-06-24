/**
 * Health + selection for the {@link FallbackSource}. This mirrors the Squid SDK's fallback
 * health model (the two SDKs deliberately share no code — only test scenarios), ported onto the
 * Pipes cursor model.
 */

/** Trinary health (§4): `unknown` lets the first batch ship before any probe completes. */
export type FallbackHealth = 'healthy' | 'unhealthy' | 'unknown'

export interface FallbackPolicy {
  /** `eager` (default) reclaims a recovered higher-preference source at a batch boundary. */
  preferPrimary?: 'eager' | 'onFailureOnly'
  /** All sources down: `null` (default) polls forever; a finite value throws after waiting. */
  allDownTimeoutMs?: number | null
  /** Backoff between all-down poll attempts. */
  allDownPollMs?: number
  /** Cooldown an `unhealthy` source waits before returning to `unknown`. */
  cooldownMs?: number
  /** `K` — consecutive failed liveness probes that flip a source `unhealthy`. */
  livenessFailThreshold?: number
  /** `M` — consecutive liveness passes (capability confirmed) required to become `healthy`. */
  livenessRecoverThreshold?: number
  /** Injectable clock (ms) for deterministic tests. Defaults to `Date.now`. */
  clock?: () => number
}

export interface ResolvedFallbackPolicy {
  preferPrimary: 'eager' | 'onFailureOnly'
  allDownTimeoutMs: number | null
  allDownPollMs: number
  cooldownMs: number
  livenessFailThreshold: number
  livenessRecoverThreshold: number
  clock: () => number
}

const DEFAULTS: ResolvedFallbackPolicy = {
  preferPrimary: 'eager',
  allDownTimeoutMs: null,
  allDownPollMs: 1000,
  cooldownMs: 30_000,
  livenessFailThreshold: 2,
  livenessRecoverThreshold: 3,
  clock: () => Date.now(),
}

export function resolveFallbackPolicy(p?: FallbackPolicy): ResolvedFallbackPolicy {
  return {
    preferPrimary: p?.preferPrimary ?? DEFAULTS.preferPrimary,
    allDownTimeoutMs: p?.allDownTimeoutMs === undefined ? DEFAULTS.allDownTimeoutMs : p.allDownTimeoutMs,
    allDownPollMs: p?.allDownPollMs ?? DEFAULTS.allDownPollMs,
    cooldownMs: p?.cooldownMs ?? DEFAULTS.cooldownMs,
    livenessFailThreshold: p?.livenessFailThreshold ?? DEFAULTS.livenessFailThreshold,
    livenessRecoverThreshold: p?.livenessRecoverThreshold ?? DEFAULTS.livenessRecoverThreshold,
    clock: p?.clock ?? DEFAULTS.clock,
  }
}

export class AllSourcesDownError extends Error {
  override readonly name = 'AllSourcesDownError'

  constructor() {
    super('all fallback data sources are unavailable')
  }
}

/**
 * Per-source trinary health state machine. Pure and timer-free: fed signals (`onStreamError`,
 * `onBatch`, liveness/capability probe results); cooldown expiry resolves lazily on `state` read.
 */
export class SourceHealth {
  #state: FallbackHealth = 'unknown'
  #livenessPass = 0
  #livenessFail = 0
  #capabilityOk: boolean
  #cooldownUntil = 0

  constructor(
    private policy: ResolvedFallbackPolicy,
    hasCapabilityProbe: boolean,
  ) {
    this.#capabilityOk = !hasCapabilityProbe
  }

  get state(): FallbackHealth {
    if (this.#state === 'unhealthy' && this.policy.clock() >= this.#cooldownUntil) {
      this.#toUnknown()
    }

    return this.#state
  }

  onStreamError(): void {
    this.#toUnhealthy()
  }

  onBatch(): void {
    this.onLivenessPass()
  }

  onLivenessPass(): void {
    if (this.state === 'unhealthy') return

    this.#livenessFail = 0
    this.#livenessPass++
    this.#maybeHealthy()
  }

  onLivenessFail(): void {
    if (this.state === 'unhealthy') return

    this.#livenessPass = 0
    this.#livenessFail++
    if (this.#livenessFail >= this.policy.livenessFailThreshold) {
      this.#toUnhealthy()
    }
  }

  onCapability(ok: boolean): void {
    if (this.state === 'unhealthy') return

    if (ok) {
      this.#capabilityOk = true
      this.#maybeHealthy()
    } else {
      this.#toUnhealthy()
    }
  }

  #maybeHealthy(): void {
    if (this.#capabilityOk && this.#livenessPass >= this.policy.livenessRecoverThreshold) {
      this.#state = 'healthy'
    }
  }

  #toUnhealthy(): void {
    this.#state = 'unhealthy'
    this.#cooldownUntil = this.policy.clock() + this.policy.cooldownMs
    this.#livenessPass = 0
    this.#livenessFail = 0
  }

  #toUnknown(): void {
    this.#state = 'unknown'
    this.#livenessPass = 0
    this.#livenessFail = 0
  }
}

/**
 * Picks the active source: failover tries the lowest-index `healthy` or `unknown` source
 * (optimistically — the stream is the fastest health test); switch-up only ever promotes to a
 * `healthy` source of higher preference (lower index) than the active one.
 */
export class Selector {
  constructor(private health: SourceHealth[]) {}

  pickForFailover(): number | undefined {
    for (let i = 0; i < this.health.length; i++) {
      const s = this.health[i].state
      if (s === 'healthy' || s === 'unknown') return i
    }

    return undefined
  }

  pickSwitchUp(active: number): number | undefined {
    for (let i = 0; i < active; i++) {
      if (this.health[i].state === 'healthy') return i
    }

    return undefined
  }
}
