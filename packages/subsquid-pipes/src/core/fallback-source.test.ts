import { describe, expect, it } from 'vitest'

import { ForkException } from '~/portal-client/index.js'

import { FallbackSource, FallbackUnderlyingSource } from './fallback-source.js'
import { createDefaultLogger } from './logger.js'
import { PortalBatch } from './portal-source.js'
import { Target } from './target.js'
import { BlockCursor } from './types.js'

/**
 * Unit tests for the generic fallback supervisor, using mock `read` functions (async generators
 * yielding `PortalBatch`es) — the meta-source analog of the Squid SDK's MockSource. No HTTP is
 * mocked here; the Portal/RPC adapters are exercised separately.
 */

/** Keep the default cause-logging (warn) out of the test output. */
const silent = createDefaultLogger({ level: 'silent' })

function cursor(n: number, hash = `0x${n}`): BlockCursor {
  return { number: n, hash }
}

function pbatch(n: number, hash?: string): PortalBatch<number[]> {
  return {
    data: [n],
    ctx: { stream: { state: { current: cursor(n, hash) }, head: {} } },
  } as unknown as PortalBatch<number[]>
}

type ReadFn = (cursor?: BlockCursor) => AsyncGenerator<PortalBatch<number[]>>

function source(
  name: string,
  read: ReadFn,
): FallbackUnderlyingSource<number[]> & { reads: (BlockCursor | undefined)[] } {
  const reads: (BlockCursor | undefined)[] = []
  return {
    name,
    reads,
    read: (c) => {
      reads.push(c)
      return read(c)
    },
  }
}

async function collect(stream: AsyncIterable<PortalBatch<number[]>>): Promise<number[]> {
  const out: number[] = []
  for await (const b of stream) out.push(...b.data)
  return out
}

/** Never resolves — models a source whose request hangs forever. */
const hang = (): Promise<never> => new Promise<never>(() => {})
/** Resolves after `ms` — models a slow request / a bounded delay before an error. */
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type HeadFn = () => Promise<BlockCursor | undefined>
type ProbeFn = () => Promise<{ ok: boolean }>

/** A mock source with an independent head poll (and, optionally, a capability probe). */
function headSource(
  name: string,
  read: ReadFn,
  getHead: HeadFn,
  probeCapability?: ProbeFn,
): FallbackUnderlyingSource<number[]> & { reads: (BlockCursor | undefined)[] } {
  return Object.assign(source(name, read), {
    getHead,
    ...(probeCapability ? { probeCapability: probeCapability as any } : {}),
  })
}

describe('FallbackSource — supervisor', () => {
  it('drives the lowest-index source; standbys are untouched', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      yield pbatch(2)
    })
    const s1 = source('s1', async function* () {
      yield pbatch(99)
    })
    const fb = new FallbackSource([s0, s1], undefined, silent)

    expect(await collect(fb.read())).toEqual([1, 2])
    expect(s1.reads).toHaveLength(0)
  })

  it('resumes the next source from the last cursor on a non-fork error', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      yield pbatch(2)
      throw new Error('boom')
    })
    const s1 = source('s1', async function* (c) {
      expect(c).toEqual(cursor(2)) // resume just after the last committed block
      yield pbatch(3)
    })
    const fb = new FallbackSource([s0, s1], undefined, silent)

    expect(await collect(fb.read())).toEqual([1, 2, 3])
    expect(s1.reads).toEqual([cursor(2)])
  })

  it('cascades through multiple failing sources', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      throw new Error('e0')
    })
    const s1 = source('s1', async function* () {
      throw new Error('e1')
    })
    const s2 = source('s2', async function* (c) {
      expect(c).toEqual(cursor(1))
      yield pbatch(2)
    })
    const fb = new FallbackSource([s0, s1, s2], undefined, silent)

    expect(await collect(fb.read())).toEqual([1, 2])
  })

  it('propagates ForkException instead of switching', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      throw new ForkException([cursor(1)], { fromBlock: 2, parentBlockHash: '0x1' })
    })
    const s1 = source('s1', async function* () {
      yield pbatch(99)
    })
    const fb = new FallbackSource([s0, s1], undefined, silent)

    const seen: number[] = []
    await expect(
      (async () => {
        for await (const b of fb.read()) seen.push(...b.data)
      })(),
    ).rejects.toBeInstanceOf(ForkException)
    expect(seen).toEqual([1])
    expect(s1.reads).toHaveLength(0)
  })

  it('reclaims a recovered higher-preference source once its capability probe confirms it', async () => {
    let now = 0
    let s0reads = 0
    const s0 = source('s0', async function* () {
      s0reads++
      if (s0reads === 1) throw new Error('s0 down') // initial failure → fail over to s1
      yield pbatch(50) // reclaimed after the probe confirms capability
    })
    let probes = 0
    s0.probeCapability = async () => {
      probes++
      return { ok: true }
    }

    const s1 = source('s1', async function* () {
      for (let n = 1; n <= 6; n++) {
        yield pbatch(n)
        now += 100 // advance the (injected) clock so s0's cooldown elapses between batches
      }
    })

    const fb = new FallbackSource(
      [s0, s1],
      {
        clock: () => now,
        cooldownMs: 50,
        capabilityProbeIntervalMs: 0,
        livenessRecoverThreshold: 1, // one successful probe is enough to confirm + recover
      },
      silent,
    )

    const out = await collect(fb.read())

    expect(probes).toBeGreaterThan(0) // the standby s0 was probed
    expect(out).toContain(50) // and reclaimed once healthy
    expect(fb.metrics().switchCount).toBe(2) // s0 → s1 (failover) → s0 (switch-up)
  })

  it('does not switch up to a standby whose capability probe keeps failing', async () => {
    let now = 0
    const s0 = source('s0', async function* () {
      throw new Error('s0 down') // always fails the real query
    })
    let probes = 0
    s0.probeCapability = async () => {
      probes++
      // reachable-but-incapable: never confirms, and reports a classified cause
      return { ok: false, cause: { check: 'capability' as const, reason: 'http' as const, code: 400, detail: 'x' } }
    }

    const s1 = source('s1', async function* () {
      for (let n = 1; n <= 4; n++) {
        yield pbatch(n)
        now += 100
      }
    })

    const fb = new FallbackSource(
      [s0, s1],
      {
        clock: () => now,
        cooldownMs: 50,
        capabilityProbeIntervalMs: 0,
        livenessRecoverThreshold: 1,
      },
      silent,
    )

    const out = await collect(fb.read())

    expect(probes).toBeGreaterThan(0) // s0 was probed but never confirmed
    expect(out).toEqual([1, 2, 3, 4]) // stayed on s1 the whole time
    expect(fb.metrics().switchCount).toBe(1) // only the initial failover — no churn back to s0
  })

  it('survives a capability probe that throws synchronously (fails as capability, flag not stranded)', async () => {
    let now = 0
    const s0 = source('s0', async function* () {
      throw new Error('s0 down') // always fails the real query
    })
    let probes = 0
    // A misbehaving custom probe that throws *synchronously*, before returning a Promise.
    s0.probeCapability = (() => {
      probes++
      throw new Error('sync boom')
    }) as any

    const s1 = source('s1', async function* () {
      for (let n = 1; n <= 4; n++) {
        yield pbatch(n)
        now += 100
      }
    })

    const fb = new FallbackSource(
      [s0, s1],
      {
        clock: () => now,
        cooldownMs: 50,
        capabilityProbeIntervalMs: 0,
        livenessRecoverThreshold: 1,
      },
      silent,
    )

    const out = await collect(fb.read())

    // Pre-fix, the synchronous throw escaped #maybeProbeCapability and stalled the read loop (and
    // stranded #capabilityProbing at true). Normalizing it into a rejection keeps the supervisor
    // streaming s1 to completion, and the probe having run proves the fire-and-forget path executed.
    expect(probes).toBeGreaterThan(0)
    expect(out).toEqual([1, 2, 3, 4])
    expect(fb.metrics().switchCount).toBe(1) // never churned back to the incapable s0
  })

  it('throws AllSourcesDown after a finite timeout', async () => {
    const down: ReadFn = async function* () {
      throw new Error('down')
    }
    const fb = new FallbackSource(
      [source('s0', down), source('s1', down)],
      { allDownTimeoutMs: 0, allDownPollMs: 1 },
      silent,
    )

    await expect(collect(fb.read())).rejects.toThrowError(/all fallback data sources/)
  })

  it('clears the active source and freshness gauges during an all-down gap', async () => {
    // One source that global-stalls (no other source ⇒ nothing fresher) then errors. On the error
    // there is no eligible source left, so the all-down path — not a switch — is the only thing that
    // can clear the freshness gauges it left set.
    const s0 = source('s0', async function* () {
      yield pbatch(50)
      await wait(60)
      throw new Error('s0 down')
    })
    const fb = new FallbackSource(
      [s0],
      { maxStalenessMs: 30, freshnessTickMs: 5, allDownTimeoutMs: 0, allDownPollMs: 1, cooldownMs: 60_000 },
      silent,
    )

    const it = fb[Symbol.asyncIterator]()
    expect((await it.next()).value.data).toEqual([50])

    // Pull the next batch so the staleness clock runs: s0 stalls past maxStalenessMs with no fresher
    // alternative → global stall flagged on the active.
    const pending = it.next()
    await wait(45)
    expect(fb.chainStalled).toBe(true)
    expect(fb.activeIndex).toBe(0)

    // s0 then errors; nothing eligible remains → all-down. The gauges must not keep reporting s0.
    await expect(pending).rejects.toThrowError(/all fallback data sources/)
    expect(fb.activeIndex).toBeUndefined()
    expect(fb.metrics().sources.every((s) => !s.active)).toBe(true)
    expect(fb.chainStalled).toBe(false)
    expect(fb.staleness).toBe(0)
    expect(fb.lag).toBe(0)
    expect(fb.chainHead).toBeUndefined()
  }, 5000)
})

describe('FallbackSource — metrics', () => {
  it('reports the active source, switch count, and per-source health', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      throw new Error('boom')
    })
    const s1 = source('s1', async function* () {
      yield pbatch(2)
    })
    const fb = new FallbackSource([s0, s1], undefined, silent)

    await collect(fb.read())
    const m = fb.metrics()

    expect(m.activeIndex).toBe(1)
    expect(m.switchCount).toBe(1)
    expect(m.sources).toMatchObject([
      { name: 's0', health: 'unhealthy', active: false },
      { name: 's1', health: 'unknown', active: true },
    ])
    // The unhealthy source carries its classified cause; the healthy/unknown one does not.
    expect(m.sources[0].cause).toMatchObject({ check: 'stream', reason: 'unknown' })
    expect(m.sources[0].cause?.detail).toContain('boom')
    expect(m.sources[1].cause).toBeUndefined()
  })
})

describe('FallbackSource — pipeTo', () => {
  it('rewinds via target.fork when a source forks, then resumes', async () => {
    let forkedTo: BlockCursor | null = null
    const s0 = source('s0', async function* (c) {
      if (c == null) {
        yield pbatch(1)
        yield pbatch(2, '0x2-bad')
        throw new ForkException([cursor(1), cursor(2, '0x2-bad')], { fromBlock: 3, parentBlockHash: '0x2-bad' })
      }
      // after the rewind, resume from the safe cursor
      expect(c).toEqual(cursor(1))
      yield pbatch(2, '0x2-good')
    })

    const written: number[] = []
    const target: Target<number[]> = {
      write: async ({ read }) => {
        for await (const b of read()) written.push(...b.data)
      },
      fork: async (previousBlocks) => {
        forkedTo = previousBlocks[0] // resolve to the common ancestor
        return forkedTo
      },
    }

    const fb = new FallbackSource([s0], undefined, silent)
    await fb.pipeTo(target)

    expect(forkedTo).toEqual(cursor(1))
    expect(written).toEqual([1, 2, 2]) // 2-bad yielded, rewound, 2-good re-served
  })
})

describe('FallbackSource — freshness', () => {
  it('(a) lag: fails over once it falls behind the independent head (after arming at the tip)', async () => {
    const s1heads = [95, 110] // first boundary arms (lag 5), second trips (lag 19)
    const s0 = source('s0', async function* () {
      yield pbatch(90)
      yield pbatch(91)
      yield pbatch(92) // not reached
    })
    const s1 = headSource(
      's1',
      async function* () {
        yield pbatch(92)
        yield pbatch(93)
      },
      async () => cursor(s1heads.shift() ?? 110),
    )
    const fb = new FallbackSource([s0, s1], { maxLagBlocks: 10, maxStalenessMs: null, headTtlMs: 0 }, silent)

    expect(await collect(fb)).toEqual([90, 91, 92, 93])
    expect(fb.activeIndex).toBe(1)
    expect(s1.reads[0]).toEqual(cursor(91)) // resumed just after the last committed block
  })

  it('(b) historical sync: a huge lag during backfill never fails over (never armed)', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      yield pbatch(2)
      yield pbatch(3)
    })
    const s1 = headSource(
      's1',
      async function* () {},
      async () => cursor(1_000_000),
    )
    const fb = new FallbackSource([s0, s1], { maxLagBlocks: 10, maxStalenessMs: null, headTtlMs: 0 }, silent)

    expect(await collect(fb)).toEqual([1, 2, 3])
    expect(fb.activeIndex).toBe(0)
  })

  it('(c) staleness: fails over a stalled source when a fresher source is ahead', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      await hang()
    })
    const s1 = headSource(
      's1',
      async function* () {
        yield pbatch(2)
      },
      async () => cursor(100),
    )
    const fb = new FallbackSource(
      [s0, s1],
      { maxStalenessMs: 30, freshnessTickMs: 5, headTtlMs: 0, maxLagBlocks: null },
      silent,
    )

    expect(await collect(fb)).toEqual([1, 2])
    expect(fb.activeIndex).toBe(1)
  }, 5000)

  it('(d) global stall: no fresher source → holds + flags chainStalled, no churn', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(50)
      await wait(120)
      throw new Error('client timeout') // eventually errors, like a real client
    })
    const s1 = headSource(
      's1',
      async function* () {
        yield pbatch(51)
      },
      async () => cursor(50), // same head → global stall
    )
    const fb = new FallbackSource(
      [s0, s1],
      { maxStalenessMs: 30, freshnessTickMs: 5, headTtlMs: 0, maxLagBlocks: null },
      silent,
    )

    const it = fb[Symbol.asyncIterator]()
    expect((await it.next()).value.data).toEqual([50])

    const pending = it.next() // hangs; staleness climbs but no fresher source exists
    await wait(80)
    expect(fb.chainStalled).toBe(true)
    expect(fb.activeIndex).toBe(0) // held — did NOT churn

    // s0 finally errors → ordinary failover to s1
    expect((await pending).value.data).toEqual([51])
    expect(fb.activeIndex).toBe(1)
    expect(fb.chainStalled).toBe(false) // cleared once progress resumed on the new source
  }, 5000)

  it('(d2) global stall: keeps probing the held source, and recovers when one becomes fresher', async () => {
    // The active hangs forever; recovery must come from continued probing of the other source.
    const s0 = source('s0', async function* () {
      yield pbatch(50)
      await hang()
    })

    const s1heads = [50, 50, 50] // global stall (same head) for a while...
    let probedCapability = 0
    const s1 = headSource(
      's1',
      async function* () {
        yield pbatch(51)
      },
      async () => cursor(s1heads.shift() ?? 51), // ...then it advances to 51
      async () => (probedCapability++, { ok: true }),
    )
    const fb = new FallbackSource(
      [s0, s1],
      { maxStalenessMs: 30, freshnessTickMs: 5, headTtlMs: 0, maxLagBlocks: null },
      silent,
    )

    const it = fb[Symbol.asyncIterator]()
    expect((await it.next()).value.data).toEqual([50])

    // While held, the supervisor keeps polling the other source — liveness *and* capability —
    // so it is positioned to notice recovery.
    const next = it.next()
    await wait(60)
    expect(fb.chainStalled).toBe(true)
    expect(s1heads.length).toBeLessThan(3) // s1's head was (re)polled during the hold (liveness)
    expect(probedCapability).toBeGreaterThan(0) // capability probe fired during the hold

    // s1's head advances past us → fail over to it, recovering without the active ever resolving.
    expect((await next).value.data).toEqual([51])
    expect(fb.activeIndex).toBe(1)
    expect(fb.chainStalled).toBe(false)
  }, 5000)

  it('(f) thresholds disabled: neither lag nor staleness fires', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      yield pbatch(2)
    })
    const s1 = headSource(
      's1',
      async function* () {},
      async () => cursor(1_000_000),
    )
    const fb = new FallbackSource([s0, s1], { maxLagBlocks: null, maxStalenessMs: null, headTtlMs: 0 }, silent)

    expect(await collect(fb)).toEqual([1, 2])
    expect(fb.activeIndex).toBe(0)
  })

  it('(g) resets freshness gauges on a switch (no stale lag from the old source)', async () => {
    const s1heads = [95, 110] // arm at lag 5, then trip at lag 19
    const s0 = source('s0', async function* () {
      yield pbatch(90)
      yield pbatch(91)
    })
    // Empty standby: after failover the stream ends immediately, so no boundary recomputes
    // freshness — exposing whether the switch itself cleared the old source's lag.
    const s1 = headSource(
      's1',
      async function* () {},
      async () => cursor(s1heads.shift() ?? 110),
    )
    const fb = new FallbackSource([s0, s1], { maxLagBlocks: 10, maxStalenessMs: null, headTtlMs: 0 }, silent)

    expect(await collect(fb)).toEqual([90, 91])
    expect(fb.activeIndex).toBe(1)
    expect(fb.lag).toBe(0) // not the stale 19 the lag trigger recorded against s0
  })

  it('(h) re-arms lag per stream: a reused instance does not inherit "at tip" for a backfill', async () => {
    let phase = 1
    const s0 = source('s0', async function* () {
      if (phase === 1) {
        yield pbatch(100)
      } else {
        yield pbatch(1)
        yield pbatch(2)
      }
    })
    // Phase 1: head sits at s0 (arms the lag trigger). Phase 2: head is far ahead (backfill).
    const s1 = headSource(
      's1',
      async function* () {},
      async () => cursor(phase === 1 ? 100 : 1_000_000),
    )
    const fb = new FallbackSource([s0, s1], { maxLagBlocks: 10, maxStalenessMs: null, headTtlMs: 0 }, silent)

    // Stream 1 reaches the tip → arms the lag trigger on the instance.
    expect(await collect(fb.read(cursor(99)))).toEqual([100])

    // Stream 2 on the SAME instance backfills far behind head. If the armed state leaked, the first
    // boundary would trip (lag ~1e6 > 10) and fail over; a per-stream reset prevents that.
    phase = 2
    expect(await collect(fb.read())).toEqual([1, 2])
    expect(fb.activeIndex).toBe(0) // stayed on s0 — no spurious failover
  })

  it('(i) does not arm lag while the reference is behind us (stale standby) — no spurious failover', async () => {
    // The standby is first *behind* the active (negative lag), then jumps to the real tip while the
    // active is still backfilling. Arming on the negative lag would let that jump trip a spurious
    // failover; gating arming on `lag >= 0` keeps us on the active.
    const s1heads = [40, 1_000] // behind us at 50 (lag -10), then far ahead
    const s0 = source('s0', async function* () {
      yield pbatch(50)
      yield pbatch(51)
      yield pbatch(52)
    })
    const s1 = headSource(
      's1',
      async function* () {},
      async () => cursor(s1heads.shift() ?? 1_000),
    )
    const fb = new FallbackSource([s0, s1], { maxLagBlocks: 10, maxStalenessMs: null, headTtlMs: 0 }, silent)

    expect(await collect(fb.read(cursor(49)))).toEqual([50, 51, 52])
    expect(fb.activeIndex).toBe(0) // never armed (was ahead of the reference) ⇒ no lag failover
  })
})

describe('FallbackSource — head-poll timeout (robustness)', () => {
  // A head poll that never resolves — models a sick standby: TCP up, no response.
  const hangHead = (): Promise<BlockCursor | undefined> => new Promise<BlockCursor | undefined>(() => {})

  it('a sick standby whose getHead hangs does not stall the healthy active source', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      yield pbatch(2)
      yield pbatch(3)
    })
    // Its head poll hangs; without the timeout, the per-batch lag check would block s0 forever.
    const s1 = headSource('s1', async function* () {}, hangHead)
    const fb = new FallbackSource(
      [s0, s1],
      {
        maxLagBlocks: 10,
        maxStalenessMs: null,
        headTtlMs: 0,
        headPollTimeoutMs: 20,
        livenessFailThreshold: 1, // one timed-out poll condemns the sick standby
        cooldownMs: 60_000,
      },
      silent,
    )

    expect(await collect(fb)).toEqual([1, 2, 3]) // the healthy primary streamed to completion
    expect(fb.activeIndex).toBe(0)
    const s1health = fb.metrics().sources[1]
    expect(s1health.health).toBe('unhealthy')
    expect(s1health.cause).toMatchObject({ check: 'liveness', reason: 'timeout' })
  }, 5000)
})

describe('FallbackSource — active capability confirmation', () => {
  it('reaches healthy by serving batches, without the standby capability probe ever running', async () => {
    let probed = 0
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      yield pbatch(2)
      yield pbatch(3)
      yield pbatch(4)
    })
    ;(s0 as { probeCapability?: () => Promise<{ ok: boolean }> }).probeCapability = async () => {
      probed++
      return { ok: true }
    }
    const fb = new FallbackSource(
      [s0],
      { livenessRecoverThreshold: 3, maxLagBlocks: null, maxStalenessMs: null },
      silent,
    )

    expect(await collect(fb)).toEqual([1, 2, 3, 4])
    // The active source proved capability by serving the query — the standby probe never ran for it,
    // yet it still left `unknown` for `healthy`.
    expect(probed).toBe(0)
    expect(fb.metrics().sources[0].health).toBe('healthy')
  })
})
