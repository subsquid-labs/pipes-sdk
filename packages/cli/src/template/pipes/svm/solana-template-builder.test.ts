import { describe, expect, it } from 'vitest'
import { templates } from '~/template/index.js'
import { Config } from '~/types/config.js'
import { SolanaTemplateBuilder } from './solana-template-builder.js'

describe('Solana Template Builder', () => {
  it('should build index.ts file using single pipe template', () => {
    const config: Config<'svm'> = {
      projectFolder: 'mock-folder',
      chainType: 'svm',
      network: 'ethereum-mainnet',
      templates: {
        'token-balances': templates.svm['token-balances'],
      },
      contractAddresses: [],
      sink: 'postgresql',
    }

    const indexerContent = new SolanaTemplateBuilder(config).build()

    expect(indexerContent).toMatchInlineSnapshot(`
      "import "dotenv/config";
      import { SolanaQueryBuilder, solanaInstructionDecoder, solanaPortalSource } from "@subsquid/pipes/solana";
      import { chunk, drizzleTarget } from "@subsquid/pipes/targets/drizzle/node-postgres";
      import { drizzle } from "drizzle-orm/node-postgres";
      import { createTransformer } from "@subsquid/pipes";
      import { PortalStreamData } from "@subsquid/pipes/portal-client";
      import { Block as SolanaBlock, FieldSelection as SolanaFieldSelection } from "@subsquid/pipes/dist/portal-client/query/solana.js";
      import { tokenBalancesTable } from "./schemas.js";

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
         * Start transforming the data coming from the source.
         * \`\`\`ts
         * .pipe(({ contract1 }) => {
         *   return contract1.SomeInstruction.map(e => {
         *     // do something
         *   })
         * })
         * \`\`\`
         */
        .pipeTo(drizzleTarget({
          db: drizzle(
            process.env.DB_CONNECTION_STR ??
              (() => { throw new Error('DB_CONNECTION_STR env missing') })(),
          ),
          tables: [tokenBalancesTable],
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
