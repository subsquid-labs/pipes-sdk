import { createTransformer } from '~/core/index.js'
import { arrayify, last } from '~/internal/array.js'

// `hash` is optional because Solana's `slotsUpdatesSubscribe` ships only `{ slot, timestamp }`
// — the hash would require a follow-up `getBlock(slot)` round-trip we don't want on the
// hot path. EVM (`eth_subscribe newHeads`) and Bitcoin (`getbestblockhash`) both populate it.
type RpcHead = { number: number; hash?: string; timestamp: Date; receivedAt: Date }

export interface RpcLatencyListener {
  stop(): void
}

export abstract class RpcLatencyWatcher {
  nodes: Map<string, Map<number, RpcHead>> = new Map()
  watchers: RpcLatencyListener[] = []

  constructor(protected rpcUrl: string | string[]) {
    this.rpcUrl = arrayify(rpcUrl)
  }

  /**
   * Subscribes each configured URL via `watch()`. Subclasses **must** call this
   * from their constructor *after* their own fields are initialized — otherwise
   * `watch()` would observe undefined subclass state, since `super()` runs
   * before subclass field initializers.
   */
  protected attach() {
    for (const url of this.rpcUrl) {
      this.nodes.set(url, new Map())
      this.watchers.push(this.watch(url))
    }
  }

  stop() {
    for (const listener of this.watchers) {
      listener.stop()
    }
  }

  cleanup(before: number) {
    for (const [, blocks] of this.nodes) {
      for (const [, block] of blocks) {
        if (block.number > before) {
          break
        }

        blocks.delete(block.number)
      }
    }
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
