import { createClient } from '@clickhouse/client'

import { commonAbis } from '~/evm/abi/common.js'
import { evmDecoder } from '~/evm/evm-decoder.js'
import { evmPortalSource } from '~/evm/evm-portal-source.js'
import { metricsServer } from '~/metrics/node/node-metrics-server.js'
import { clickhouseTarget } from '~/targets/clickhouse/clickouse-target.js'

import { RunConfig, createRunner } from './runner.js'

export type Params = { dataset: string }

async function transfers({ params, logger, metrics, runnerCtx }: RunConfig<Params>) {
  console.log(runnerCtx)

  evmPortalSource({
    portal: `https://portal.sqd.dev/datasets/${params.dataset}`,
    metrics,
    logger,
    runnerCtx,
  })
    .pipe(
      evmDecoder({
        range: { from: '0' },
        events: {
          transfers: commonAbis.erc20.events.Transfer,
        },
      }),
    )
    .pipe((data) =>
      data.transfers.map((t) => ({
        ...t.event,
        value: t.event.value.toString(),
        block_number: t.block.number,
        tx_hash: t.rawEvent.transactionHash,
        log_index: t.rawEvent.logIndex,
        token_address: t.contract,
        chain: params.dataset,
      })),
    )
    .pipeTo(
      clickhouseTarget({
        client: createClient({
          username: 'default',
          password: 'default',
          url: 'http://localhost:10123',
        }),
        onStart: ({ store }) => {
          store.command({
            query: `
            CREATE TABLE IF NOT EXISTS erc20_transfers (
              chain String,
              block_number UInt32,
              tx_hash String,
              log_index UInt16,
              from String,
              to String,
              value UInt256,
              token_address String,
              sign Int8 DEFAULT 1
            )
            ENGINE = CollapsingMergeTree(sign)
            ORDER BY (chain, block_number, tx_hash, log_index)
            `,
          })
        },
        onData: async ({ data, store }) => {
          await store.insert({
            values: data,
            table: 'erc20_transfers',
            format: 'JSONEachRow',
          })
        },
      }),
    )
}

async function main() {
  await createRunner<Params>(
    [
      { id: 'arb', params: { dataset: 'arbitrum-one' }, stream: transfers },
      { id: 'ethereum', params: { dataset: 'ethereum-mainnet' }, stream: transfers },
    ],
    {
      metrics: metricsServer(),
    },
  ).start()
}

void main()
