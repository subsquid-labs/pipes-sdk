import { describe, expect, it } from 'vitest'

import { ForkException } from '~/portal-client/index.js'

import { makeCapabilityProbe } from './fallback-capability.js'
import { FallbackUnderlyingSource } from './fallback-source.js'
import { PortalBatch } from './portal-source.js'
import { BlockCursor } from './types.js'

function cursor(n: number): BlockCursor {
  return { number: n, hash: `0x${n}` }
}

function pbatch(n: number): PortalBatch<number[]> {
  return {
    data: [n],
    ctx: { stream: { state: { current: cursor(n) }, head: {} } },
  } as unknown as PortalBatch<number[]>
}

type ReadFn = (cursor?: BlockCursor) => AsyncGenerator<PortalBatch<number[]>>

function source(read: ReadFn): FallbackUnderlyingSource<number[]> & { reads: (BlockCursor | undefined)[] } {
  const reads: (BlockCursor | undefined)[] = []
  return {
    name: 'mock',
    reads,
    read: (c) => {
      reads.push(c)
      return read(c)
    },
  }
}

describe('makeCapabilityProbe', () => {
  it('reads a slice at the asked-for cursor and reports capable when it serves', async () => {
    const s = source(async function* () {
      yield pbatch(100)
    })
    expect(await makeCapabilityProbe(s)(cursor(99))).toBe(true)
    expect(s.reads).toEqual([cursor(99)])
  })

  it('reports capable when the slice is empty (served the query, nothing matched)', async () => {
    const s = source(async function* () {})
    expect(await makeCapabilityProbe(s)(cursor(99))).toBe(true)
  })

  it('reports not-capable when the source cannot serve the slice', async () => {
    const s = source(async function* () {
      throw new Error('the method trace_block does not exist')
    })
    expect(await makeCapabilityProbe(s)(cursor(99))).toBe(false)
  })

  it('treats a ForkException as capable (served + reorg, not an inability to serve)', async () => {
    const s = source(async function* () {
      throw new ForkException([cursor(99)], { fromBlock: 100, parentBlockHash: '0x99' })
    })
    expect(await makeCapabilityProbe(s)(cursor(99))).toBe(true)
  })

  it('reports not-capable when the slice exceeds the probe timeout', async () => {
    const s = source(async function* () {
      await new Promise<void>(() => {}) // hang — never yields
    })
    expect(await makeCapabilityProbe(s, { timeoutMs: 20 })(cursor(99))).toBe(false)
  })
})
