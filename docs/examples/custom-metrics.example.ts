import { createEvmDecoder, createEvmPortalSource } from '@sqd-pipes/pipes/evm'
import { events } from './contracts/erc20'

async function cli() {
  const stream = createEvmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  }).pipe(
    createEvmDecoder({
      profiler: { id: 'erc20_transfers' },
      range: { from: 'latest' },
      events: {
        transfers: events.Transfer,
      },
    }),
  )

  /*
   * Stream exposes Prometheus metrics by default
   * You can add your own custom metrics as well
   *
   * Here we add a counter to count the number of processed transfers
   *
   * You can also create gauges, histograms, and summaries
   * See
   * //TODO: add link to docs
   */

  for await (const { data, ctx } of stream) {
    console.log(`parsed ${data.transfers.length} transfers`)

    ctx.metrics
      .counter({ name: 'my_transfers_counter', help: 'Number of processed transactions' })
      .inc(data.transfers.length)
  }

  /*
     Open http://localhost:9090/metrics to see the metrics

     # HELP my_transfers_counter Number of processed transactions
     # TYPE my_transfers_counter counter
     my_transfers_counter 218598

    */
}

void cli()
