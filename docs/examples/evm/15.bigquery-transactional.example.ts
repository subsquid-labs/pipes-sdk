/**
 * Example: indexing ERC20 transfers into BigQuery using the transactional target.
 *
 * Each batch is committed atomically — the data inserts and the cursor update
 * happen inside a single BigQuery transaction/session.  If the process crashes
 * mid-batch the transaction is automatically rolled back, so there is never any
 * partial data on restart.
 *
 * Prerequisites:
 * - A Google Cloud project with BigQuery enabled
 * - A BigQuery dataset that already exists (the target creates tables but not datasets)
 *
 * Required environment variables:
 *   BIGQUERY_PROJECT_ID   — GCP project ID
 *   BIGQUERY_DATASET      — destination dataset name (e.g. "ethereum")
 *
 * Credentials — supply ONE of the following:
 *
 *   Option A — path to a service account JSON key file (recommended for local dev):
 *     GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *     The BigQuery client SDK picks this up automatically; no extra config needed.
 *
 *   Option B — individual credential fields (useful for secrets managers / CI):
 *     BIGQUERY_CLIENT_EMAIL=sa@project.iam.gserviceaccount.com
 *     BIGQUERY_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...
 *
 * To run:
 *   bun run docs/examples/evm/15.bigquery-transactional.example.ts
 */

import { BigQuery } from '@google-cloud/bigquery'
import { commonAbis, evmDecoder, evmPortalStream } from '@subsquid/pipes/evm'
import { bigqueryTransactionalTarget } from '@subsquid/pipes/targets/bigquery'
import { opentelemetryProfiler } from '@subsquid/pipes/opentelemetry'
import { metricsServer } from '@subsquid/pipes/metrics/node'

const PROJECT_ID = process.env['BIGQUERY_PROJECT_ID']
const DATASET = process.env['BIGQUERY_DATASET'] ?? 'ethereum'

// Build the BigQuery client.
//
// Option A: GOOGLE_APPLICATION_CREDENTIALS env var is picked up automatically
// by the SDK when it is set; simply pass the project id.
//
// Option B: supply individual credential fields via env vars.
const bigquery =
  process.env['BIGQUERY_CLIENT_EMAIL'] != null
    ? new BigQuery({
        projectId: PROJECT_ID,
        credentials: {
          client_email: process.env['BIGQUERY_CLIENT_EMAIL'],
          // Newlines in private keys are often escaped as \n in env vars
          private_key: process.env['BIGQUERY_PRIVATE_KEY']?.replace(/\\n/g, '\n'),
        },
      })
    : new BigQuery({ projectId: PROJECT_ID })

async function main() {
  await evmPortalStream({
    id: 'ethereum-erc20-transfers-bq',
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    outputs: evmDecoder({
      range: { from: 15_000_000, to: 15_050_400 }, // 1 week
      events: {
        transfers: commonAbis.erc20.events.Transfer,
      },
    }),
    profiler: opentelemetryProfiler(),
    metrics: metricsServer(),
  }).pipeTo(
    bigqueryTransactionalTarget({
      bigquery,
      dataset: DATASET,

      onStart: async ({ store }) => {
        // Create the destination table once on startup.
        // value is stored as STRING to preserve full uint256 precision.
        await store.ddl(`
          CREATE TABLE IF NOT EXISTS \`${DATASET}.erc20_transfers\` (
            block_number      INT64     NOT NULL,
            log_index         INT64     NOT NULL,
            transaction_index INT64     NOT NULL,
            tx_hash           STRING    NOT NULL,
            token_address     STRING    NOT NULL,
            from_address      STRING    NOT NULL,
            to_address        STRING    NOT NULL,
            value             STRING    NOT NULL,
            block_timestamp   TIMESTAMP NOT NULL
          )
          PARTITION BY DATE(block_timestamp)
          CLUSTER BY token_address
        `)
      },

      onData: async ({ session, data, ctx }) => {
        if (data.transfers.length === 0) return

        ctx.logger.info(`Inserting ${data.transfers.length} ERC20 transfers`)

        // Collect columns as parallel arrays — BigQuery's UNNEST-based bulk insert
        // is much faster than building a single large VALUES clause.
        const blockNumber: number[] = []
        const logIndex: number[] = []
        const transactionIndex: number[] = []
        const txHash: string[] = []
        const tokenAddress: string[] = []
        const fromAddress: string[] = []
        const toAddress: string[] = []
        const value: string[] = []
        const blockTimestamp: string[] = []

        for (const t of data.transfers) {
          blockNumber.push(t.block.number)
          logIndex.push(t.rawEvent.logIndex)
          transactionIndex.push(t.rawEvent.transactionIndex)
          txHash.push(t.rawEvent.transactionHash)
          tokenAddress.push(t.rawEvent.address)
          fromAddress.push(t.event.from)
          toAddress.push(t.event.to)
          value.push(t.event.value.toString())
          blockTimestamp.push(t.timestamp.toISOString())
        }

        // UNNEST aligns the parallel arrays by row offset.
        // Each array param is declared with its BQ element type via `types`.
        await session.query(
          `
          INSERT INTO \`${DATASET}.erc20_transfers\`
            (block_number, log_index, transaction_index, tx_hash,
             token_address, from_address, to_address, value, block_timestamp)
          SELECT
            block_number, log_index, transaction_index, tx_hash,
            token_address, from_address, to_address, value,
            CAST(block_timestamp AS TIMESTAMP)
          FROM UNNEST(@block_number)       AS block_number       WITH OFFSET
          JOIN UNNEST(@log_index)          AS log_index          WITH OFFSET USING (OFFSET)
          JOIN UNNEST(@transaction_index)  AS transaction_index  WITH OFFSET USING (OFFSET)
          JOIN UNNEST(@tx_hash)            AS tx_hash            WITH OFFSET USING (OFFSET)
          JOIN UNNEST(@token_address)      AS token_address      WITH OFFSET USING (OFFSET)
          JOIN UNNEST(@from_address)       AS from_address       WITH OFFSET USING (OFFSET)
          JOIN UNNEST(@to_address)         AS to_address         WITH OFFSET USING (OFFSET)
          JOIN UNNEST(@value)              AS value              WITH OFFSET USING (OFFSET)
          JOIN UNNEST(@block_timestamp)    AS block_timestamp    WITH OFFSET USING (OFFSET)
          `,
          {
            block_number: blockNumber,
            log_index: logIndex,
            transaction_index: transactionIndex,
            tx_hash: txHash,
            token_address: tokenAddress,
            from_address: fromAddress,
            to_address: toAddress,
            value,
            block_timestamp: blockTimestamp,
          },
          {
            block_number: ['INT64'],
            log_index: ['INT64'],
            transaction_index: ['INT64'],
            tx_hash: ['STRING'],
            token_address: ['STRING'],
            from_address: ['STRING'],
            to_address: ['STRING'],
            value: ['STRING'],
            block_timestamp: ['STRING'],
          },
        )
      },

      onRollback: async ({ type }) => {
        // Because every batch is committed atomically (data + cursor in a single
        // transaction), there is never partial data from a previous run.
        // This callback is a no-op for pure BigQuery writes, but you can add
        // logging or clean up external state here if needed.
        console.log(`[${type}] Transactions guarantee atomicity — nothing to clean up.`)
      },
    }),
  )
}

void main()
