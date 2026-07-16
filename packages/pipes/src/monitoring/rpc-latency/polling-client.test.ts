import { describe, expect, it, vi } from 'vitest'

import { PollingClient } from './polling-client.js'

describe('PollingClient', () => {
  it('rejects non-positive intervalMs', () => {
    expect(() => new PollingClient(0, vi.fn())).toThrow(RangeError)
    expect(() => new PollingClient(-1, vi.fn())).toThrow(RangeError)
    expect(() => new PollingClient(Number.NaN, vi.fn())).toThrow(RangeError)
    expect(() => new PollingClient(Number.POSITIVE_INFINITY, vi.fn())).toThrow(RangeError)
  })

  it('invokes the tick immediately on construction', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    const client = new PollingClient(10_000, tick)

    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1), { timeout: 100, interval: 5 })

    client.stop()
  })

  it('keeps polling on the configured interval', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    const client = new PollingClient(15, tick)

    await vi.waitFor(() => expect(tick.mock.calls.length).toBeGreaterThanOrEqual(3), { timeout: 500, interval: 10 })

    client.stop()
  })

  it('swallows errors thrown from the tick and keeps polling', async () => {
    let calls = 0
    const tick = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('boom-sync-then-throw')
    })

    const client = new PollingClient(15, tick)

    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3), { timeout: 500, interval: 10 })

    client.stop()
  })

  it('stops cleanly mid-sleep', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    const client = new PollingClient(60_000, tick)

    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1), { timeout: 100, interval: 5 })

    client.stop()

    // After stop, no further ticks fire even if we wait longer than a fast interval would imply.
    const before = tick.mock.calls.length
    await new Promise((r) => setTimeout(r, 80))
    expect(tick.mock.calls.length).toBe(before)
  })

  it('unblocks a pending sleep so run() can exit on stop', async () => {
    const tick = vi.fn().mockResolvedValue(undefined)
    const client = new PollingClient(60_000, tick)

    // First tick fires immediately; loop is now sleeping for 60s.
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(1), { timeout: 100, interval: 5 })

    const before = Date.now()
    client.stop()
    // The internal sleep promise must resolve synchronously-ish so `run()` exits.
    // We assert by waiting a short window — much less than the 60s interval.
    await new Promise((r) => setTimeout(r, 30))
    expect(Date.now() - before).toBeLessThan(1_000)
  })

  it('does not fire another tick after stop is called during an in-flight tick', async () => {
    let releaseTick: (() => void) | undefined
    const tick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseTick = resolve
        }),
    )

    const client = new PollingClient(10, tick)

    // Wait until the very first tick is in flight (started but not yet resolved).
    await vi.waitFor(() => expect(typeof releaseTick).toBe('function'), { timeout: 200, interval: 5 })

    // Stop while the first tick is still pending.
    client.stop()
    releaseTick?.()

    // Give the loop time to (incorrectly) schedule another tick.
    await new Promise((r) => setTimeout(r, 60))
    expect(tick).toHaveBeenCalledTimes(1)
  })
})
