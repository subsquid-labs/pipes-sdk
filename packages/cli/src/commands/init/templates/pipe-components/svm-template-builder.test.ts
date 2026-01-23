import { describe, expect, it } from 'vitest'
import { Config } from '~/types/init.js'
import { svmTemplates } from '../pipe-templates/svm/index.js'
import { SvmTemplateBuilder } from './svm-template-builder.js'

describe.skip('SVM Template Builder', () => {
  it('should build index.ts file using single pipe template', () => {
    const config: Config<'svm'> = {
      projectFolder: 'mock-folder',
      networkType: 'svm',
      network: 'ethereum-mainnet',
      templates: [svmTemplates['tokenBalances']],
      contractAddresses: [],
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    const indexerContent = new SvmTemplateBuilder(config).build()

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
