import { Token } from '../types.js'

export interface TokenStore {
  migrate(): Promise<void> | void
  save(tokens: Token[]): Promise<void> | void
  get(addresses: string[]): Promise<Record<string, Token>>
}
