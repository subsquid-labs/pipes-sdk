import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'
import { RunConfig, createRunner } from '@subsquid/pipes/runtime/node'

export type Params = { dataset: string }

async function transfers({ id, params, metrics, logger }: RunConfig<Params>) {
  const stream = evmPortalSource({
    portal: `https://portal.sqd.dev/datasets/${params.dataset}`,
    metrics,
    logger,
    streams: evmDecoder({
      range: { from: 'latest' },
      events: {
        transfers: commonAbis.erc20.events.Transfer,
      },
    }),
  })

  for await (const { ctx, data } of stream) {
    ctx.logger.debug(`fetched ${data.transfers.length} transfers`)
  }
}

async function main() {
  const run = createRunner<Params>(
    [
      { id: 'arb', params: { dataset: 'arbitrum-one' }, stream: transfers },
      { id: 'ethereum', params: { dataset: 'ethereum-mainnet' }, stream: transfers },
    ],
    { metrics: { port: 3000 } },
  )

  await run.start()
}

main()
