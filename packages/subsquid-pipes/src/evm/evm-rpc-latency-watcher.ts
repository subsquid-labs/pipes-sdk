import { evmQuery } from '~/evm/evm-query-builder.js'
import { RpcLatencyWatcher, WebSocketListener, rpcLatencyWatcher } from '~/monitoring/index.js'

class EvmRpcLatencyWatcher extends RpcLatencyWatcher {
  watch(url: string): WebSocketListener {
    const listener = new WebSocketListener(url)

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_subscribe',
      params: ['newHeads'],
    }

    listener.subscribe(payload, (message: { method: string; params: { result: { number: string; timestamp: string } } }) => {
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

export function evmRpcLatencyWatcher({ rpcUrl }: { rpcUrl: string[] }) {
  const transformer = rpcLatencyWatcher({
    watcher: new EvmRpcLatencyWatcher(rpcUrl),
  })

  return evmQuery()
    .addFields({
      block: {
        number: true,
        timestamp: true,
      },
    })
    .build(transformer.options)
}
