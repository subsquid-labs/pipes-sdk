import { Token } from './types.js'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const EvmMulticallAddress = '0xcA11bde05977b3631167028862bE2a173976CA11'

export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
export const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'
export const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
export const GHO = '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f'
export const FRAX = '0x853d955acef822db058eb8505911ed77f175b99e'
export const USDS = '0xdc035d45d973e3ec169d2276ddab16f1e407384f'

export const stables = [USDC, USDT, DAI, GHO, FRAX, USDS] as const
export type Stable = (typeof stables)[number]

const STABLE_METADATA: Record<Stable, Token> = {
  [USDC]: {
    address: USDC,
    symbol: 'USDC',
    name: 'Circle USD',
    decimals: 6,
  },
  [USDT]: {
    address: USDT,
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
  [DAI]: {
    address: DAI,
    symbol: 'DAI',
    name: 'Dai',
    decimals: 18,
  },
  [GHO]: {
    address: GHO,
    symbol: 'GHO',
    name: 'Gho',
    decimals: 18,
  },
  [FRAX]: {
    address: FRAX,
    symbol: 'FRAX',
    name: 'Frax',
    decimals: 18,
  },
  [USDS]: {
    address: USDS,
    symbol: 'USDS',
    name: 'USDS Stablecoin',
    decimals: 18,
  },
}
