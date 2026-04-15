import 'dotenv/config'
import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'
import { chunk, drizzleTarget } from '@subsquid/pipes/targets/drizzle/node-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import { z } from 'zod'
import { erc20TransfersTable } from './schemas.js'

const env = z
  .object({
    DB_CONNECTION_STR: z.string(),
  })
  .parse(process.env)

const erc20Transfers = evmDecoder({
  profiler: { id: 'erc20-transfers' }, // Optional: add a profiler to measure the performance of the transformer
  range: { from: '20000000' },
  contracts: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
  events: {
    transfers: commonAbis.erc20.events.Transfer,
  },
}).pipe(({ transfers }) =>
  transfers.map((transfer) => ({
    blockNumber: transfer.block.number,
    txHash: transfer.rawEvent.transactionHash,
    logIndex: transfer.rawEvent.logIndex,
    timestamp: transfer.timestamp.getTime(),
    from: transfer.event.from,
    to: transfer.event.to,
    value: transfer.event.value,
    tokenAddress: transfer.contract,
  })),
)

export async function main() {
  await evmPortalSource({
    id: 'ea4d63d0',
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    outputs: {
      erc20Transfers,
    },
  }).pipeTo(
    drizzleTarget({
      db: drizzle(env.DB_CONNECTION_STR),
      tables: [erc20TransfersTable],
      onData: async ({ tx, data }) => {
        for (const values of chunk(data.erc20Transfers)) {
          await tx.insert(erc20TransfersTable).values(values)
        }
      },
    }),
  )
}

void main()
