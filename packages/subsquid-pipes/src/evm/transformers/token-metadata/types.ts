export type StringKeyValues<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T]

export type Token = {
  address: string
  decimals: number
  symbol: string
  name: string
}

export interface TokenStore {
  migrate(): Promise<void> | void
  save(tokens: Token[]): Promise<void> | void
  get(addresses: string[]): Promise<Record<string, Token>>
}

export type LFUEntry<V> = { value: V; freq: number; pinned: boolean }
