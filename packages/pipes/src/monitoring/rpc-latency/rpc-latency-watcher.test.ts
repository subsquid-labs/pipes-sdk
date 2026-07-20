import { describe, expect, it } from 'vitest'

import type { BatchContext } from '~/core/portal-source.js'

import { type RpcLatencyListener, RpcLatencyWatcher, rpcLatencyWatcher } from './rpc-latency-watcher.js'

class StubWatcher extends RpcLatencyWatcher {
  watched: string[] = []
  stopped = 0

  watch(url: string): RpcLatencyListener {
    this.watched.push(url)

    return {
      stop: () => {
        this.stopped++
      },
    }
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
    watcher.start()

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
    watcher.start()

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
    watcher.start()
    // No addBlock calls — lookup returns [].

    const transformer = rpcLatencyWatcher({ watcher })
    const result = await transformer.run([{ header: { number: 999, timestamp: 0 } }], makeBatchContext(new Date()))

    expect(result).toBeNull()
  })
})

describe('RpcLatencyWatcher lifecycle', () => {
  it('re-subscribes after stop(), so a stream restart does not blind it permanently', () => {
    // stop() used to be a one-way latch: after the first restart the sockets stayed
    // shut and lookup() returned [] forever, freezing the gauges on their last value.
    const watcher = new StubWatcher(['ws://rpc-1', 'ws://rpc-2'])

    watcher.start()
    expect(watcher.watched).toEqual(['ws://rpc-1', 'ws://rpc-2'])

    watcher.stop()
    expect(watcher.stopped).toBe(2)

    watcher.start()
    expect(watcher.watched).toEqual(['ws://rpc-1', 'ws://rpc-2', 'ws://rpc-1', 'ws://rpc-2'])
  })

  it('retains observed heads across a restart', () => {
    // Dropping the buffer would stall matching until each RPC re-observed a head.
    const watcher = new StubWatcher(['ws://rpc'])
    watcher.start()
    watcher.addBlock('ws://rpc', { number: 7, timestamp: new Date(), receivedAt: new Date() })

    watcher.stop()
    watcher.start()

    expect(watcher.lookup(7)).toHaveLength(1)
  })

  it('ignores a repeated start()', () => {
    const watcher = new StubWatcher(['ws://rpc'])

    watcher.start()
    watcher.start()

    expect(watcher.watched).toEqual(['ws://rpc'])
  })

  it('ignores a repeated stop() instead of stopping listeners twice', () => {
    const watcher = new StubWatcher(['ws://rpc'])
    watcher.start()

    watcher.stop()
    watcher.stop()

    expect(watcher.stopped).toBe(1)
  })

  it('subscribes from the transformer start hook', async () => {
    const watcher = new StubWatcher(['ws://rpc'])
    const transformer = rpcLatencyWatcher({ watcher })

    await transformer.start({} as never)

    expect(watcher.watched).toEqual(['ws://rpc'])
  })

  it('evicts the oldest heads once a node exceeds the retention cap', () => {
    // Nothing pruned `nodes`, so entries accumulated for the process's lifetime.
    const watcher = new StubWatcher(['ws://rpc'])
    watcher.start()

    for (let i = 1; i <= 600; i++) {
      watcher.addBlock('ws://rpc', { number: i, timestamp: new Date(), receivedAt: new Date() })
    }

    expect(watcher.nodes.get('ws://rpc')?.size).toBe(512)
    expect(watcher.lookup(88)).toEqual([])
    expect(watcher.lookup(89)).toHaveLength(1)
    expect(watcher.lookup(600)).toHaveLength(1)
  })
})
