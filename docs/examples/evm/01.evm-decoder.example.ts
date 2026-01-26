import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'

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
    // logger: 'debug',
    outputs: evmDecoder({
      range: { from: 'latest' },
      events: {
        transfers: commonAbis.erc20.events.Transfer,
      },
    }),
  })

  for await (const { data } of stream) {
    console.log(data.transfers.length)
  }
}

void cli()
