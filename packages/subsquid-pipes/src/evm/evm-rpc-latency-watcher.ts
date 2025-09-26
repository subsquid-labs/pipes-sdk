import { RpcLatencyWatcher, rpcLatencyWatcher } from '~/monitoring/index.js'
import { WebSocketListener } from '~/monitoring/rpc-latency/ws-client.js'

class EvmRpcLatencyWatcher extends RpcLatencyWatcher {
  watch(url: string) {
    const listener = new WebSocketListener(url)

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_subscribe',
      params: ['newHeads'],
    }

    listener.subscribe(payload, (message) => {
      if (message.method !== 'eth_subscription') return
      const head = message.params.result

      this.addBlock(url, {
        number: parseInt(head.number),
        timestamp: new Date(parseInt(head.timestamp) * 1000),
        receivedAt: new Date(),
      })
    })

    return listener
  }
}

export function createEvmRpcLatencyWatcher({ rpcUrl }: { rpcUrl: string[] }) {
  return rpcLatencyWatcher(new EvmRpcLatencyWatcher(rpcUrl))
}
