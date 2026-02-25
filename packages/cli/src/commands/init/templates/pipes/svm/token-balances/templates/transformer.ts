import { createTransformer } from '@subsquid/pipes'
import { PortalStreamData } from '@subsquid/pipes/portal-client'
import { SolanaQueryBuilder } from '@subsquid/pipes/solana'
import {
  Block as SolanaBlock,
  FieldSelection as SolanaFieldSelection,
} from 'node_modules/@subsquid/pipes/dist/portal-client/query/solana.js'

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
