import { createTransformer } from '~/core/index.js'
import { arrayify, last } from '~/internal/array.js'

// `hash` is optional because Solana's `slotsUpdatesSubscribe` ships only `{ slot, timestamp }`
// — the hash would require a follow-up `getBlock(slot)` round-trip we don't want on the
// hot path. EVM (`eth_subscribe newHeads`) and Bitcoin (`getbestblockhash`) both populate it.
type RpcHead = { number: number; hash?: string; timestamp: Date; receivedAt: Date }

/** Lookups only move forward, so older heads are dead weight. */
const MAX_HEADS_PER_NODE = 512

export interface RpcLatencyListener {
  stop(): void
}

export abstract class RpcLatencyWatcher {
  nodes: Map<string, Map<number, RpcHead>> = new Map()
  watchers: RpcLatencyListener[] = []
  #running = false

  constructor(protected rpcUrl: string | string[]) {
    this.rpcUrl = arrayify(rpcUrl)
  }

  /**
   * Subscribes each URL via `watch()`. Idempotent and re-runnable after `stop()`:
   * the stream stops and starts transformers around every restart, and a one-way
   * stop would leave `lookup()` empty forever while the stream kept indexing.
   *
   * Driven by the transformer, not a subclass constructor, so `watch()` always
   * sees initialized subclass fields.
   */
  start() {
    if (this.#running) return
    this.#running = true

    for (const url of arrayify(this.rpcUrl)) {
      if (!this.nodes.has(url)) {
        this.nodes.set(url, new Map())
      }

      this.watchers.push(this.watch(url))
    }
  }

  stop() {
    if (!this.#running) return
    this.#running = false

    for (const listener of this.watchers) {
      listener.stop()
    }

    this.watchers = []
  }

  lookup(number: number) {
    const res: { url: string; hash?: string; timestamp: Date; receivedAt: Date }[] = []

    for (const [url, blocks] of this.nodes) {
      const block = blocks.get(number)

      if (block) {
        res.push({
          url,
          hash: block.hash,
          timestamp: block.timestamp,
          receivedAt: block.receivedAt,
        })
      }
    }

    return res
  }

  addBlock(url: string, block: RpcHead) {
    const chain = this.nodes.get(url)
    if (!chain) throw new Error('RPC not found')

    chain.set(block.number, block)

    // Insertion order is ascending, so the first key is the oldest. Evicting here
    // rather than on portal batches holds the bound while the portal side is stalled.
    while (chain.size > MAX_HEADS_PER_NODE) {
      const oldest = chain.keys().next()
      if (oldest.done) break

      chain.delete(oldest.value)
    }
  }

  abstract watch(url: string): RpcLatencyListener
}

type Latency = {
  number: number
  timestamp: Date
  portal: {
    receivedAt: Date
  }
  rpc: {
    url: string
    /** Block hash as observed by this RPC. Omitted on Solana (no hash on slot updates). */
    hash?: string
    portalDelayMs: number
    receivedAt?: Date
  }[]
}

export function rpcLatencyWatcher({ watcher }: { watcher: RpcLatencyWatcher }) {
  return createTransformer<
    {
      header: { number: number; timestamp: number }
    }[],
    Latency | null
  >({
    profiler: { name: 'rpc latency' },
    start() {
      watcher.start()
    },
    transform: (data, ctx): Latency | null => {
      const receivedAt = ctx.batch.lastBlockReceivedAt

      const block = last(data)
      if (!block) return null

      const lookup = watcher.lookup(block.header.number)
      if (lookup.length === 0) return null

      return {
        number: block.header.number,
        timestamp: new Date(block.header.timestamp * 1000),
        portal: { receivedAt },
        rpc: lookup.map((r) => {
          return {
            url: r.url,
            hash: r.hash,
            receivedAt: r.receivedAt,
            portalDelayMs: receivedAt.getTime() - r.receivedAt.getTime(),
          }
        }),
      }
    },
    stop() {
      watcher.stop()
    },
  })
}
