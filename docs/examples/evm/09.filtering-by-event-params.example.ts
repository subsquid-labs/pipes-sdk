import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'
import { metricsServer } from '@subsquid/pipes/metrics/node'

/**
 * Basic example demonstrating how to use pipes for processing EVM data.
 * This example shows how to:
 * - Create a data stream from Base Mainnet using Portal API
 * - Decode ERC20 transfer events
 * - Process the transformed events in a streaming fashion
 */
async function cli() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    metrics: metricsServer(),
  }).pipe(
    evmDecoder({
      range: { from: '24171448', to: '24171449' },
      events: {
        // Listening for all approval events
        // approvals: commonAbis.erc20.events.Approval,
        // Listening to all transfers to zero address
        transfers: {
          event: commonAbis.erc20.events.Transfer,
          params: {
            to: '0x0000000000000000000000000000000000000000',
          },
        },
      },
    }),
  )

  for await (const { data } of stream) {
    console.log({
      // app: data.approvals.length,
      tx: data.transfers.length,
    })
  }
}

void cli()
