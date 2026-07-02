import { describe, expect, it } from 'vitest'

import type { BatchContext } from '~/core/portal-source.js'

import { RpcLatencyWatcher, type RpcLatencyListener, rpcLatencyWatcher } from './rpc-latency-watcher.js'

class StubWatcher extends RpcLatencyWatcher {
  watch(): RpcLatencyListener {
    return { stop: () => {} }
  }
  /** Skip subscribing — tests populate `nodes` directly via addBlock. */
  preregister(url: string): void {
    this.nodes.set(url, new Map())
  }
}

const profilerStub: Record<string, unknown> = {
  start: () => profilerStub,
  measure: async (_: unknown, fn: () => unknown) => fn(),
  end: () => {},
  data: undefined,
}

function makeBatchContext(receivedAt: Date): BatchContext {
  return {
    profiler: profilerStub,
    batch: {
      blocksCount: 1,
      bytesSize: 0,
      requests: {},
      lastBlockReceivedAt: receivedAt,
    },
  } as unknown as BatchContext
}

describe('rpcLatencyWatcher transformer', () => {
  it('propagates the RPC-observed hash from lookup() into LatencySample.rpc[].hash', async () => {
    // Reorg-safe joining downstream (BigQuery freshness probe) requires the hash to flow
    // end-to-end: addBlock → lookup → LatencySample. A regression dropping the field would
    // silently break (number, hash) matching, leaving the probe pairing observations across
    // chain forks. This pins the wire-up.
    const watcher = new StubWatcher(['ws://rpc-1', 'ws://rpc-2'])
    watcher.preregister('ws://rpc-1')
    watcher.preregister('ws://rpc-2')

    const blockTimestamp = new Date('2026-05-09T00:00:00Z')
    const rpc1ReceivedAt = new Date('2026-05-09T00:00:01Z')
    const rpc2ReceivedAt = new Date('2026-05-09T00:00:02Z')
    watcher.addBlock('ws://rpc-1', {
      number: 100,
      hash: '0xCANONICAL',
      timestamp: blockTimestamp,
      receivedAt: rpc1ReceivedAt,
    })
    watcher.addBlock('ws://rpc-2', {
      number: 100,
      hash: '0xCANONICAL',
      timestamp: blockTimestamp,
      receivedAt: rpc2ReceivedAt,
    })

    const transformer = rpcLatencyWatcher({ watcher })
    const portalReceivedAt = new Date('2026-05-09T00:00:03Z')
    const result = await transformer.run(
      [{ header: { number: 100, timestamp: blockTimestamp.getTime() / 1000 } }],
      makeBatchContext(portalReceivedAt),
    )

    expect(result).not.toBeNull()
    expect(result?.number).toBe(100)
    expect(result?.rpc).toEqual([
      { url: 'ws://rpc-1', hash: '0xCANONICAL', receivedAt: rpc1ReceivedAt, portalDelayMs: 2000 },
      { url: 'ws://rpc-2', hash: '0xCANONICAL', receivedAt: rpc2ReceivedAt, portalDelayMs: 1000 },
    ])
  })

  it('emits hash=undefined for sources that do not carry one (e.g. Solana)', async () => {
    // Solana's slot updates carry no hash; the field stays undefined end-to-end. Downstream
    // consumers degrade to number-only matching — this test pins that the pipeline doesn't
    // accidentally fabricate a value (e.g. empty string) on the way through.
    const watcher = new StubWatcher(['ws://rpc'])
    watcher.preregister('ws://rpc')

    watcher.addBlock('ws://rpc', {
      number: 42,
      timestamp: new Date('2026-05-09T00:00:00Z'),
      receivedAt: new Date('2026-05-09T00:00:01Z'),
    })

    const transformer = rpcLatencyWatcher({ watcher })
    const result = await transformer.run(
      [{ header: { number: 42, timestamp: new Date('2026-05-09T00:00:00Z').getTime() / 1000 } }],
      makeBatchContext(new Date('2026-05-09T00:00:02Z')),
    )

    expect(result?.rpc[0]?.hash).toBeUndefined()
  })

  it('returns null when no RPC has seen the block (lookup empty)', async () => {
    const watcher = new StubWatcher(['ws://rpc'])
    watcher.preregister('ws://rpc')
    // No addBlock calls — lookup returns [].

    const transformer = rpcLatencyWatcher({ watcher })
    const result = await transformer.run(
      [{ header: { number: 999, timestamp: 0 } }],
      makeBatchContext(new Date()),
    )

    expect(result).toBeNull()
  })
})
