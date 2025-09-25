import WebSocket from 'ws'
import { createTransformer, Transformer } from '~/core'
import { PortalBatch } from '~/core/portal-source.ts'
import { arrayify } from '~/internal/array.ts'

type RpcHead = { number: number; timestamp: Date; receivedAt: Date }

class RpcLatencyWatcher {
  nodes: Map<string, Map<number, RpcHead>> = new Map()
  watchers: (() => void)[] = []

  constructor(protected rpcUrl: string | string[]) {
    this.rpcUrl = arrayify(rpcUrl)

    for (const url of this.rpcUrl) {
      this.nodes.set(url, new Map())
      this.watchers.push(this.watch(url))
    }
  }

  stop() {
    for (const stop of this.watchers) {
      stop()
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
    const res: { url: string; timestamp?: Date; receivedAt?: Date }[] = []

    for (const [url, blocks] of this.nodes) {
      const block = blocks.get(number)

      res.push({
        url,
        timestamp: block?.timestamp,
        receivedAt: block?.receivedAt,
      })
    }

    return res
  }

  addBlock(url: string, block: RpcHead) {
    const chain = this.nodes.get(url)
    if (!chain) throw new Error('RPC not found')

    chain.set(block.number, block)
  }

  watch(url: string) {
    let ws: WebSocket | undefined
    let subscriptionId: string | undefined
    let stopped = false
    let reconnectAttempts = 0
    const subscribeRequestId = 1
    const unsubscribeRequestId = 2
    let reconnectTimer: NodeJS.Timeout | undefined

    const scheduleReconnect = () => {
      if (stopped) return
      const baseDelayMs = 500
      const maxDelayMs = 15_000
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** reconnectAttempts)
      const jitter = Math.floor(Math.random() * 250)
      reconnectTimer = setTimeout(connect, delay + jitter)
      reconnectAttempts += 1
    }

    const connect = () => {
      if (stopped) return
      try {
        ws = new WebSocket(url)
      } catch {
        scheduleReconnect()
        return
      }

      const sendSubscribe = () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const payload = {
          jsonrpc: '2.0',
          id: subscribeRequestId,
          method: 'eth_subscribe',
          params: ['newHeads'],
        }
        ws.send(JSON.stringify(payload))
      }

      ws.on('open', () => {
        reconnectAttempts = 0
        subscriptionId = undefined
        sendSubscribe()
      })

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as any

          if (message?.id === subscribeRequestId && message?.result && !subscriptionId) {
            subscriptionId = message.result as string
            return
          }

          if (
            message?.method === 'eth_subscription' &&
            message?.params?.subscription &&
            (subscriptionId == null || message.params.subscription === subscriptionId)
          ) {
            const head = message.params.result

            this.addBlock(url, {
              number: parseInt(head.number),
              timestamp: new Date(parseInt(head.timestamp) * 1000),
              receivedAt: new Date(),
            })
          }
        } catch {
          // ignore malformed messages
        }
      })

      ws.on('error', () => {
        // Let 'close' drive reconnection
      })

      ws.on('close', () => {
        subscriptionId = undefined
        if (!stopped) scheduleReconnect()
      })
    }

    connect()

    // Return a stop function that unsubscribes and closes the socket and cancels retries
    return () => {
      stopped = true
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      const current = ws
      ws = undefined
      try {
        if (current && current.readyState === WebSocket.OPEN && subscriptionId) {
          const payload = {
            jsonrpc: '2.0',
            id: unsubscribeRequestId,
            method: 'eth_unsubscribe',
            params: [subscriptionId],
          }
          current.send(JSON.stringify(payload))
        }
      } catch {}
      try {
        current?.close()
      } catch {}
    }
  }
}

export function rpcLatencyWatcher({ rpcUrl }: { rpcUrl: string[] }): Transformer<
  PortalBatch<{ blocks: { header: { number: number; timestamp: number } }[] }>,
  {
    number: number
    timestamp: Date
    portal: { receivedAt: Date }
    rpc: { url: string; receivedAt?: Date; portalDelay?: string }[]
  }[]
> {
  const cache = new RpcLatencyWatcher(rpcUrl)

  return createTransformer({
    profiler: { id: 'rpc-latency' },
    transform: ({ data }) => {
      // FIXME!
      return data.blocks.flatMap((b: any) => {
        return {
          number: b.header.number,
          timestamp: new Date(b.header.timestamp * 1000),
          portal: {
            receivedAt: new Date(b.meta.receivedAt),
          },
          rpc: cache.lookup(b.header.number).map((r) => {
            if (!r.receivedAt) return { url: r.url, portalDelay: 'unknown' }

            const portalDelay = b.meta.receivedAt.getTime() - r.receivedAt.getTime()

            return {
              url: r.url,
              receivedAt: r.receivedAt,
              timestamp: r.timestamp,
              portalDelay: portalDelay < 0 ? `${portalDelay}ms` : `+${portalDelay}ms`,
            }
          }),
        }
      })
    },
    stop() {
      cache.stop()
    },
  })
}
