import { createClient } from '@clickhouse/client'
import { createEvmDecoder, createEvmPortalSource } from '@sqd-pipes/pipes/evm'
import { createClickhouseTarget } from '@sqd-pipes/pipes/targets/clickhouse'

import { events } from './contracts/erc20.ts'

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
        profiler: { id: 'erc20_transfers' },
        range: { from: 'latest' },
        events: {
          transfers: events.Transfer,
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
