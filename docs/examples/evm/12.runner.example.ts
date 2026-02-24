import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'
import { RunConfig, createDevRunner } from '@subsquid/pipes/runtime/node'

export type Params = { dataset: string }

async function transfers({ id, params, metrics, logger }: RunConfig<Params>) {
  const stream = evmPortalSource({
    id,
    portal: `https://portal.sqd.dev/datasets/${params.dataset}`,
    metrics,
    logger,
    outputs: evmDecoder({
      range: { from: '0' },
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
  const run = createDevRunner<Params>(
    [
      { id: 'arb', params: { dataset: 'arbitrum-one' }, stream: transfers },
      { id: 'ethereum', params: { dataset: 'ethereum-mainnet' }, stream: transfers },
    ],
    { metrics: { port: 9090 } },
  )

  await run.start()
}

main()
