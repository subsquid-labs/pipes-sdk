import { describe, expect, it } from 'vitest'

import { Selector, SourceHealth, resolveFallbackPolicy } from './fallback-health.js'

function setup(opts: { hasCapabilityProbe?: boolean; cooldownMs?: number } = {}) {
  let now = 0
  const policy = resolveFallbackPolicy({
    clock: () => now,
    cooldownMs: opts.cooldownMs ?? 1000,
    livenessFailThreshold: 2,
    livenessRecoverThreshold: 3,
  })
  const health = new SourceHealth(policy, opts.hasCapabilityProbe ?? false)

  return { health, advance: (ms: number) => (now += ms) }
}

describe('SourceHealth', () => {
  it('starts unknown', () => {
    expect(setup().health.state).toBe('unknown')
  })

  it('a stream error flips it unhealthy until cooldown elapses', () => {
    const { health, advance } = setup({ cooldownMs: 1000 })
    health.onStreamError()
    expect(health.state).toBe('unhealthy')
    advance(999)
    expect(health.state).toBe('unhealthy')
    advance(1)
    expect(health.state).toBe('unknown')
  })

  it('promotes unknown → healthy after M liveness passes (no capability probe)', () => {
    const { health } = setup()
    health.onLivenessPass()
    health.onLivenessPass()
    expect(health.state).toBe('unknown')
    health.onLivenessPass()
    expect(health.state).toBe('healthy')
  })

  it('with a capability probe, liveness alone is not enough', () => {
    const { health } = setup({ hasCapabilityProbe: true })
    health.onLivenessPass()
    health.onLivenessPass()
    health.onLivenessPass()
    expect(health.state).toBe('unknown')
    health.onCapability(true)
    expect(health.state).toBe('healthy')
  })

  it('K consecutive liveness fails flip it unhealthy', () => {
    const { health } = setup()
    health.onLivenessFail()
    expect(health.state).toBe('unknown')
    health.onLivenessFail()
    expect(health.state).toBe('unhealthy')
  })

  it('a probed source cannot recover on liveness alone after going unhealthy — capability must be re-proved', () => {
    const { health, advance } = setup({ hasCapabilityProbe: true, cooldownMs: 1000 })

    // Confirm capability once and reach healthy.
    health.onCapability(true)
    health.onLivenessPass()
    health.onLivenessPass()
    health.onLivenessPass()
    expect(health.state).toBe('healthy')

    // It fails the real query and goes unhealthy; cooldown returns it to unknown.
    health.onStreamError()
    advance(1000)
    expect(health.state).toBe('unknown')

    // Liveness recovers but capability is no longer confirmed — it must NOT flap back to healthy
    // without a fresh probe, or we get the churn loop.
    health.onLivenessPass()
    health.onLivenessPass()
    health.onLivenessPass()
    expect(health.state).toBe('unknown')

    // A fresh successful probe is what finally promotes it.
    health.onCapability(true)
    expect(health.state).toBe('healthy')
  })

  it('a probe-less source still recovers on liveness alone after cooldown', () => {
    const { health, advance } = setup({ hasCapabilityProbe: false, cooldownMs: 1000 })
    health.onStreamError()
    advance(1000)
    expect(health.state).toBe('unknown')

    health.onLivenessPass()
    health.onLivenessPass()
    health.onLivenessPass()
    expect(health.state).toBe('healthy')
  })
})

describe('Selector', () => {
  it('failover picks the lowest healthy/unknown; switch-up only healthy above active', () => {
    const policy = resolveFallbackPolicy({ livenessRecoverThreshold: 1 })
    const health = [new SourceHealth(policy, false), new SourceHealth(policy, false), new SourceHealth(policy, false)]
    const selector = new Selector(health)

    // all unknown → failover picks index 0
    expect(selector.pickForFailover()).toBe(0)
    expect(selector.pickSwitchUp(2)).toBeUndefined() // none healthy yet

    health[0].onStreamError() // s0 unhealthy
    expect(selector.pickForFailover()).toBe(1)

    health[0].onLivenessPass() // s0 still cooling down → stays unhealthy
    health[1].onLivenessPass() // s1 → healthy (M=1)
    expect(selector.pickSwitchUp(2)).toBe(1)
  })
})
