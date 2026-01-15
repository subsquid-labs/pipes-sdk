export type Token = {
  address: string
  decimals: number
  symbol: string
  name: string
}

export type LFUEntry<V> = { value: V; freq: number; pinned: boolean }
