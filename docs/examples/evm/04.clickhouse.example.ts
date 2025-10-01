import { createClient } from '@clickhouse/client'
import { commonAbis, createEvmDecoder, createEvmPortalSource } from '@sqd-pipes/pipes/evm'
import { createClickhouseTarget } from '@sqd-pipes/pipes/targets/clickhouse'

/**
 * This example demonstrates how to use ClickHouse as a target for storing processed blockchain data.
 * It creates a connection to a local ClickHouse instance, sets up an EVM Portal Source to stream
 * ERC20 transfer events from Base Mainnet, and pipes the decoded data to ClickHouse while
 * measuring performance with a profiler.
 */
async function cli() {
  const client = createClient({
    username: 'default',
    password: 'default',
    url: 'http://localhost:10123',
  })

  await createEvmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/base-mainnet',
  })
    .pipe(
      createEvmDecoder({
        profiler: { id: 'ERC20 transfers' },
        range: { from: 'latest' },
        events: {
          transfers: commonAbis.erc20.events.Transfer,
        },
      }),
    )
    .pipeTo(
      createClickhouseTarget({
        client,
        onRollback: async () => {},
        onData: async ({ data, ctx }) => {
          const span = ctx.profiler.start('my measure')
          console.log('batch')
          console.log(`parsed ${data.transfers.length} transfers`)
          console.log('----------------------------------')
          span.end()
        },
      }),
    )
}

void cli()
