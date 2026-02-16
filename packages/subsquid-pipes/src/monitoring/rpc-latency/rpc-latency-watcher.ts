import { createTransformer } from '~/core/index.js'
import { arrayify, last } from '~/internal/array.js'

import { WebSocketListener } from './ws-client.js'

type RpcHead = { number: number; timestamp: Date; receivedAt: Date }

export abstract class RpcLatencyWatcher {
  nodes: Map<string, Map<number, RpcHead>> = new Map()
  watchers: WebSocketListener[] = []

  constructor(protected rpcUrl: string | string[]) {
    this.rpcUrl = arrayify(rpcUrl)

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
    const res: { url: string; timestamp: Date; receivedAt: Date }[] = []

    for (const [url, blocks] of this.nodes) {
      const block = blocks.get(number)

      if (block) {
        res.push({
          url,
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

  abstract watch(url: string): WebSocketListener
}

type Latency = {
  number: number
  timestamp: Date
  portal: {
    receivedAt: Date
  }
  rpc: {
    url: string
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
    profiler: { id: 'rpc latency' },
    transform: (data, ctx): Latency | null => {
      const receivedAt = ctx.meta.lastBlockReceivedAt

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
