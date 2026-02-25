import { ClickHouseClient } from '@clickhouse/client'

import { Token } from '../types.js'
import { TokenStore } from './types.js'

const nullToUndefined = (x: any) => {
  for (const key in x) {
    if (x[key] === null) x[key] = undefined
  }
  return x
}

export class ClickHouseTokenStore implements TokenStore {
  constructor(private readonly client: ClickHouseClient) {}

  async migrate(): Promise<void> {
    const table = `
      CREATE TABLE IF NOT EXISTS evm_tokens
      (
        address String,
        decimals UInt8,
        symbol String,
        name String
      )
      ENGINE = EmbeddedRocksDB
      PRIMARY KEY address;
    `

    await this.client.exec({ query: table })
  }

  async save(tokens: Token[]): Promise<void> {
    if (!tokens.length) return

    await this.client.insert({
      table: 'evm_tokens',
      values: tokens.map((token) => ({
        address: token.address,
        decimals: token.decimals,
        symbol: token.symbol ?? '',
        name: token.name ?? '',
      })),
      format: 'JSONEachRow',
    })
  }

  async get(addresses: string[]): Promise<Record<string, Token>> {
    if (!addresses.length) return {}

    const resultSet = await this.client.query({
      query: `
        SELECT
          address,
          decimals,
          symbol,
          name
        FROM evm_tokens
        WHERE address IN {addresses:Array(String)}
      `,
      format: 'JSONEachRow',
      query_params: { addresses },
    })

    const tokensMetadata = await resultSet.json<{
      address: string
      decimals: number
      symbol: string | null
      name: string | null
    }>()

    return tokensMetadata.reduce<Record<string, Token>>((res, token) => {
      res[token.address] = nullToUndefined({
        ...token,
        decimals: token.decimals,
        symbol: token.symbol ?? '',
        name: token.name ?? '',
      })
      return res
    }, {})
  }
}
