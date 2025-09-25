import { createEvmDecoder, createEvmPortalSource } from '@sqd-pipes/pipes/evm'
import { events } from './contracts/erc20'

async function cli() {
  const stream = createEvmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/base-mainnet',
  }).pipe(
    createEvmDecoder({
      profiler: { id: 'erc20_transfers' },
      range: { from: 'latest' },
      events: {
        transfers: events.Transfer,
      },
    }).pipe({
      transform: ({ transfers }) => {
        return {
          transfers: transfers.map((e) => ({
            ...e,
            type: 'transfer',
          })),
        }
      },
    }),
  )

  for await (const { data } of stream) {
    console.log(data.transfers[0].type)
  }
}

void cli()
