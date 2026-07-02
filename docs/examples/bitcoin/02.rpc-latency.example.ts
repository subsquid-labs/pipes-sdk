import { formatBlock } from '@subsquid/pipes'
import { bitcoinPortalStream, bitcoinRpcLatencyWatcher } from '@subsquid/pipes/bitcoin'

/**
 * Compares Subsquid Portal indexing latency against a public Bitcoin Core JSON-RPC node.
 *
 * Bitcoin Core does NOT expose WebSocket subscriptions, so the latency watcher
 * polls `getbestblockhash` + `getblockheader` over HTTP. The default poll
 * interval is 4s; tune via `intervalMs`. Each request has its own AbortController
 * timeout (`requestTimeoutMs`, default `max(1000, intervalMs)`) so a stalled RPC
 * can never block the loop.
 *
 * For self-hosted nodes that require auth, encode credentials in the URL:
 *   `http://user:pass@127.0.0.1:8332`
 * and the watcher will emit `Authorization: Basic <...>` automatically (Node's
 * `fetch` does not honor URL credentials by itself).
 *
 * ⚠️ The reported latency includes client-side network RTT and does NOT capture
 * the node's internal block-validation time.
 */
async function main() {
  const stream = bitcoinPortalStream({
    id: 'bitcoin-indexing-latency',
    portal: process.env['PORTAL_URL'] || 'https://portal.sqd.dev/datasets/bitcoin-mainnet',

    outputs: bitcoinRpcLatencyWatcher({
      // Public, keyless Bitcoin Core JSON-RPC. PublicNode is the simplest one to
      // smoke-test against; for a production deploy, point this at your own
      // bitcoind or a keyed provider (QuickNode, GetBlock, Ankr, ...).
      rpcUrl: ['https://bitcoin-rpc.publicnode.com'],
      intervalMs: 4_000,
    }).pipe((data) => data),
  })

  for await (const { data } of stream) {
    if (!data) continue

    console.log(`-------------------------------------`)
    console.log(`BLOCK DATA: ${formatBlock(data.number)} / ${data.timestamp.toString()}`)
    console.table(data.rpc)
  }

  /*
  Example output:
  -------------------------------------
  BLOCK DATA: 900,123 / Mon Jan 06 2025 12:34:56 GMT+0400
  ┌───┬───────────────────────────────────────┬──────────────────────────┬───────────────┐
  │   │ url                                   │ receivedAt               │ portalDelayMs │
  ├───┼───────────────────────────────────────┼──────────────────────────┼───────────────┤
  │ 0 │ https://bitcoin-rpc.publicnode.com    │ 2025-01-06T08:34:56.812Z │ 1843          │
  └───┴───────────────────────────────────────┴──────────────────────────┴───────────────┘
  */
}

void main()
