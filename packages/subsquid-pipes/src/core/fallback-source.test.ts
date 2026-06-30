import { describe, expect, it } from 'vitest'

import { ForkException } from '~/portal-client/index.js'

import { FallbackSource, FallbackUnderlyingSource } from './fallback-source.js'
import { PortalBatch } from './portal-source.js'
import { Target } from './target.js'
import { BlockCursor } from './types.js'

/**
 * Unit tests for the generic fallback supervisor, using mock `read` functions (async generators
 * yielding `PortalBatch`es) — the meta-source analog of the Squid SDK's MockSource. No HTTP is
 * mocked here; the Portal/RPC adapters are exercised separately.
 */

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

describe('FallbackSource — supervisor', () => {
  it('drives the lowest-index source; standbys are untouched', async () => {
    const s0 = source('s0', async function* () {
      yield pbatch(1)
      yield pbatch(2)
    })
    const s1 = source('s1', async function* () {
      yield pbatch(99)
    })
    const fb = new FallbackSource([s0, s1])

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
    const fb = new FallbackSource([s0, s1])

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
    const fb = new FallbackSource([s0, s1, s2])

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
    const fb = new FallbackSource([s0, s1])

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
      return true
    }

    const s1 = source('s1', async function* () {
      for (let n = 1; n <= 6; n++) {
        yield pbatch(n)
        now += 100 // advance the (injected) clock so s0's cooldown elapses between batches
      }
    })

    const fb = new FallbackSource([s0, s1], {
      clock: () => now,
      cooldownMs: 50,
      capabilityProbeIntervalMs: 0,
      livenessRecoverThreshold: 1, // one successful probe is enough to confirm + recover
    })

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
      return false // reachable-but-incapable: never confirms
    }

    const s1 = source('s1', async function* () {
      for (let n = 1; n <= 4; n++) {
        yield pbatch(n)
        now += 100
      }
    })

    const fb = new FallbackSource([s0, s1], {
      clock: () => now,
      cooldownMs: 50,
      capabilityProbeIntervalMs: 0,
      livenessRecoverThreshold: 1,
    })

    const out = await collect(fb.read())

    expect(probes).toBeGreaterThan(0) // s0 was probed but never confirmed
    expect(out).toEqual([1, 2, 3, 4]) // stayed on s1 the whole time
    expect(fb.metrics().switchCount).toBe(1) // only the initial failover — no churn back to s0
  })

  it('throws AllSourcesDown after a finite timeout', async () => {
    const down: ReadFn = async function* () {
      throw new Error('down')
    }
    const fb = new FallbackSource([source('s0', down), source('s1', down)], {
      allDownTimeoutMs: 0,
      allDownPollMs: 1,
    })

    await expect(collect(fb.read())).rejects.toThrowError(/all fallback data sources/)
  })
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
    const fb = new FallbackSource([s0, s1])

    await collect(fb.read())
    const m = fb.metrics()

    expect(m.activeIndex).toBe(1)
    expect(m.switchCount).toBe(1)
    expect(m.sources).toEqual([
      { name: 's0', health: 'unhealthy', active: false },
      { name: 's1', health: 'unknown', active: true },
    ])
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

    const fb = new FallbackSource([s0])
    await fb.pipeTo(target)

    expect(forkedTo).toEqual(cursor(1))
    expect(written).toEqual([1, 2, 2]) // 2-bad yielded, rewound, 2-good re-served
  })
})
