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
    outputs: evmDecoder({
      range: {
        from: 'latest',
        // from: '1,000,000',
        // from: startOfDay(new Date())
        // from: '2024-01-01',
      },
      events: {
        transfers: commonAbis.erc20.events.Transfer,
      },
    }),

    metrics: metricsServer(),
  })

  for await (const { data } of stream) {
    console.log(data.transfers.length)
  }
}

void cli()
