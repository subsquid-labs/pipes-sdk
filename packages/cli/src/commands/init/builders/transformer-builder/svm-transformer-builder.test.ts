import { describe, expect, it } from 'vitest'
import { Config } from '~/types/init.js'
import { svmTemplates } from '../../templates/pipes/svm/index.js'
import { TransformerBuilder } from './index.js'
import { ProjectWriter } from '~/utils/project-writer.js'
import { ContractMetadata } from '~/services/sqd-abi.js'

const projectWriter = new ProjectWriter('mock-folder')

const whirlpoolMetadata: ContractMetadata[] = [
  {
    contractAddress: '0x0000000000000000000000000000000000000000',
    contractName: 'whirpool',
    contractEvents: [
      {
        name: 'Swap',
        type: 'event',
        inputs: [
          {
            name: 'amount0',
            type: 'i128',
          },
          {
            name: 'amount1',
            type: 'i128',
          },
          {
            name: 'sqrt_price_x96',
            type: 'i128',
          },
        ],
      },
    ],
  },
]

describe('SVM Template Builder', () => {
  it('should build index.ts file using custom template', async () => {
    const config: Config<'svm'> = {
      projectFolder: 'mock-folder',
      networkType: 'svm',
      network: 'ethereum-mainnet',
      templates: [svmTemplates.custom.setParams({ contracts: whirlpoolMetadata })],
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    const indexerContent = await new TransformerBuilder(config, projectWriter).render()

    expect(indexerContent).toMatchInlineSnapshot(`
      "import "dotenv/config";
      import { solanaInstructionDecoder, solanaPortalSource } from "@subsquid/pipes/solana";
      import { z } from "zod";
      import path from "node:path";
      import { clickhouseTarget } from "@subsquid/pipes/targets/clickhouse";
      import { createClient } from "@clickhouse/client";
      import { enrichEvents, serializeJsonWithBigInt, toSnakeKeysArray } from "./utils/index.js";
      import { instructions as whirpoolInstructions } from "./contracts/0x0000000000000000000000000000000000000000/index.js";

      const env = z.object({
        CLICKHOUSE_USER: z.string(),
        CLICKHOUSE_PASSWORD: z.string(),
        CLICKHOUSE_URL: z.string(),
        CLICKHOUSE_DATABASE: z.string(),
      }).parse(process.env)

      const custom = solanaInstructionDecoder({
        range: { from: 'latest' },
        programId: [
          "0x0000000000000000000000000000000000000000",
        ],
        /**
         * Or optionally use pass all events object directly to listen to all contract events
         * \`\`\`ts
         * events: myContractEvents,
         * \`\`\`
         */
        instructions: {
          Swap: whirpoolInstructions.Swap,
        },
      }).pipe(enrichEvents)

      export async function main() {
        await solanaPortalSource({
          portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
        })
        .pipeComposite({
          custom,
        })
        /**
         * Or optionally use only a subset of events by passing the events object directly:
         * \`\`\`ts
         * .pipe(({ contract1 }) => {
         *   return contract1.SomeInstruction.map(e => {
         *     // do something
         *   })
         * })
         * \`\`\`
         */
        .pipeTo(clickhouseTarget({
          client: createClient({
              username: env.CLICKHOUSE_USER,
              password: env.CLICKHOUSE_PASSWORD,
              url: env.CLICKHOUSE_URL,
              database: env.CLICKHOUSE_DATABASE,
              json: {
                  stringify: serializeJsonWithBigInt,
              },
              clickhouse_settings: {
                  date_time_input_format: 'best_effort',
                  date_time_output_format: 'iso',
                  output_format_json_named_tuples_as_objects: 1,
                  output_format_json_quote_64bit_floats: 1,
                  output_format_json_quote_64bit_integers: 1,
              },
          }),
          onStart: async ({ store }) => {
            const migrationsDir = path.join(process.cwd(), 'migrations')
            await store.executeFiles(migrationsDir)
          },
          onData: async ({ data, store }) => {
            await store.insert({
              table: 'whirpool_swap',
              values: toSnakeKeysArray(data.custom.Swap),
              format: 'JSONEachRow',
            });
          },
          onRollback: async ({ safeCursor, store }) => {
            await store.removeAllRows({
              tables: [
                'whirpool_swap',
              ],
              where: 'block_number > {latest:UInt32}',
              params: { latest: safeCursor.number },
            });
          },
        }))
      }

      void main()
      "
    `)
  })

  it.skip('should build index.ts file using single pipe template', async () => {
    const config: Config<'svm'> = {
      projectFolder: 'mock-folder',
      networkType: 'svm',
      network: 'ethereum-mainnet',
      templates: [],
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    const indexerContent = await new TransformerBuilder(config, projectWriter).render()

    expect(indexerContent).toMatchInlineSnapshot(`
      "import "dotenv/config";
      import { SolanaQueryBuilder, solanaPortalSource } from "@subsquid/pipes/solana";
      import { z } from "zod";
      import { chunk, drizzleTarget } from "@subsquid/pipes/targets/drizzle/node-postgres";
      import { drizzle } from "drizzle-orm/node-postgres";
      import { tokenBalancesTable } from "./schemas.js";
      import { createTransformer } from "@subsquid/pipes";
      import { PortalStreamData } from "@subsquid/pipes/portal-client";
      import { Block as SolanaBlock, FieldSelection as SolanaFieldSelection } from "@subsquid/pipes/dist/portal-client/query/solana.js";

      const env = z.object({
        DB_CONNECTION_STR: z.string(),
      }).parse(process.env)

      interface TokenBalance {
        blockNumber: number
        blockHash: string
        blockTime: number
        tokenAddress: string
        owner: string
        amount: number
      }

      export const tokenBalances = createTransformer<
        PortalStreamData<SolanaBlock<SolanaFieldSelection>>,
        TokenBalance[],
        SolanaQueryBuilder
      >({
        query: ({ queryBuilder }) => {
          queryBuilder
            .addFields({
              block: {
                number: true,
                hash: true,
                timestamp: true,
              },
              tokenBalance: {
                preDecimals: true,
                preAmount: true,
                postAmount: true,
                preOwner: true,
                postOwner: true,
                preMint: true,
              },
            })
            .addTokenBalance({
              range: { from: '372,195,730' },
              request: {
                // You can filter in that way. it is much faster, but the query has a limit of 5000 addresses
                // preMint: ['tokenProgramId']
              },
            })
        },
        transform: (data) =>
          data.blocks.flatMap((block) =>
            block.tokenBalances.flatMap((balance) => {
              const balances: TokenBalance[] = []

              const tokenAddress = balance.preMint

              if (!tokenAddress) return balances

              balances.push({
                blockNumber: block.header.number,
                blockHash: block.header.hash,
                blockTime: block.header.timestamp,
                tokenAddress: tokenAddress.toString(),
                owner: balance.preOwner?.toString() ?? '',
                amount: Number(balance.preAmount) / 10 ** Number(balance.preDecimals),
              })

              balances.push({
                blockNumber: block.header.number,
                blockHash: block.header.hash,
                blockTime: block.header.timestamp,
                tokenAddress: tokenAddress.toString(),
                owner: balance.postOwner?.toString() ?? '',
                amount: Number(balance.postAmount) / 10 ** Number(balance.preDecimals),
              })

              return balances.filter((balance): balance is TokenBalance => balance.owner !== '')
            }),
          ),
      })

      export async function main() {
        await solanaPortalSource({
          portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
        })
        .pipeComposite({
          tokenBalances,
        })
        /**
         * Or optionally use only a subset of events by passing the events object directly:
         * \`\`\`ts
         * .pipe(({ contract1 }) => {
         *   return contract1.SomeInstruction.map(e => {
         *     // do something
         *   })
         * })
         * \`\`\`
         */
        .pipeTo(drizzleTarget({
          db: drizzle(env.DB_CONNECTION_STR),
          tables: [
            tokenBalancesTable,
          ],
          onData: async ({ tx, data }) => {
            for (const values of chunk(data.tokenBalances)) {
              await tx.insert(tokenBalancesTable).values(values)
            }
          },
        }))
      }

      void main()
      "
    `)
  })

  // TODO: implement this test once we have more than one Solana template
  it('should build index.ts combining multiple pipe templates', () => {})
})
