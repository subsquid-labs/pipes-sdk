import { commonAbis, createEvmDecoder, createEvmPortalSource } from '@sqd-pipes/pipes/evm'
import { createNodeMetricsServer } from '@sqd-pipes/pipes/metrics/node'
import { chunk, createDrizzleTarget } from '@sqd-pipes/pipes/targets/drizzle/node-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { transfersTable } from './drizzle/transfers/schema'

type NewTransfer = typeof transfersTable.$inferInsert

async function main() {
  await createEvmPortalSource({
    portal: {
      url: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    },
    metrics: createNodeMetricsServer(),
  })
    .pipe(
      createEvmDecoder({
        range: { from: '0' },
        events: {
          transfers: commonAbis.erc20.events.Transfer,
        },
      }),
    )
    .pipeTo(
      createDrizzleTarget({
        db: drizzle('postgresql://postgres:postgres@localhost:5432/postgres'),
        tables: [transfersTable],
        onStart: async ({ db }) => {
          /*
           * [Optional] Run migrations
           */
          await migrate(db, { migrationsFolder: `${__dirname}/drizzle/transfers/migrations` })
        },
        onData: async ({ tx, data, ctx }) => {
          ctx.logger.debug(`Processing batch with ${data.transfers.length} transfer events...`)

          for (const values of chunk(data.transfers)) {
            ctx.logger.debug(`Inserting ${values.length} transfer events...`)

            await tx.insert(transfersTable).values(
              values.map(
                (d): NewTransfer => ({
                  // Compound ID
                  blockNumber: d.block.number,
                  logIndex: d.rawEvent.logIndex,
                  transactionIndex: d.rawEvent.transactionIndex,
                  // ----
                  from: d.event.from,
                  to: d.event.to,
                  amount: d.event.value,
                  createdAt: d.timestamp,
                }),
              ),
            )
          }
        },
      }),
    )
}

void main()
