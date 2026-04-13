import { formatBlock } from '@subsquid/pipes'
import { solanaPortalSource, solanaRpcLatencyWatcher } from '@subsquid/pipes/solana'

/**
 * This example demonstrates how to track and compare block indexing latency
 * between the Subsquid Portal and external RPC providers.
 * It listens for new block heads and measures the time until blocks are
 * observed on the client side through both RPC endpoints and the Portal.

 ******************************************************************************
 * ⚠️ Important:
 * - The measured values INCLUDE client-side network latency.
 * - For RPC, only the *arrival time* of the block is measured — this does NOT
 *   capture the node’s internal processing or response latency if queried directly.
 *****************************************************************************

 * In other words, the results represent end-to-end delays as experienced by the client,
 * not the pure Portal latency or RPC processing performance.
 */

async function main() {
  // Create a stream of new blocks from the Base mainnet portal
  const stream = solanaPortalSource({
    portal: 'https://portal.sqd.dev/datasets/solana-mainnet',
    outputs: solanaRpcLatencyWatcher({
      rpcUrl: ['https://api.mainnet-beta.solana.com'], // RPC endpoints to monitor
    }).pipe({
      profiler: { id: 'expose metrics' },
      transform: (data, { metrics }) => {
        if (!data) return // Skip if no latency data

        // For each RPC endpoint, update the latency gauge metric
        for (const rpc of data.rpc) {
          metrics
            .gauge({
              name: 'rpc_latency_ms',
              help: 'RPC Latency in ms',
              labelNames: ['url'],
            })
            .set({ url: rpc.url }, data.rpc[0].portalDelayMs)
        }

        return data
      },
    }),
  })

  // Iterate over the stream, logging block and RPC latency data
  for await (const { data } of stream) {
    if (!data) continue // Skip if no block data

    // Log block number and timestamp
    console.log(`-------------------------------------`)
    console.log(`BLOCK DATA: ${formatBlock(data.number)} / ${data.timestamp.toString()}`)
    // Log RPC latency table for the block
    console.table(data.rpc)

    /**
    EXAMPLE OUTPUT:
    -------------------------------------
    BLOCK DATA: 369,377,455 / Fri Sep 26 2025 15:31:36 GMT+0400 (Georgia Standard Time)
    ┌───┬─────────────────────────────────────┬──────────────────────────┬───────────────┐
    │   │ url                                 │ receivedAt               │ portalDelayMs │
    ├───┼─────────────────────────────────────┼──────────────────────────┼───────────────┤
    │ 0 │ https://api.mainnet-beta.solana.com │ 2025-09-26T11:31:37.075Z │ 358           │
    └───┴─────────────────────────────────────┴──────────────────────────┴───────────────┘
    -------------------------------------
    BLOCK DATA: 369,377,457 / Fri Sep 26 2025 15:31:37 GMT+0400 (Georgia Standard Time)
    ┌───┬─────────────────────────────────────┬──────────────────────────┬───────────────┐
    │   │ url                                 │ receivedAt               │ portalDelayMs │
    ├───┼─────────────────────────────────────┼──────────────────────────┼───────────────┤
    │ 0 │ https://api.mainnet-beta.solana.com │ 2025-09-26T11:31:37.830Z │ 297           │
    └───┴─────────────────────────────────────┴──────────────────────────┴───────────────┘
     */
  }
}

// Start the main function
void main()
