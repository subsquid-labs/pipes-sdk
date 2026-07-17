export type EvmChain = {
  id: 'ethereum' | 'polygon'
  portalUrl: string
  /** 'ethereum': hex signature values + *_lossless twins; 'standard': decimal dual-rep records. */
  schemaShape: 'ethereum' | 'standard'
  features: { withdrawals: boolean; uncles: boolean }
}

export const ethereum: EvmChain = {
  id: 'ethereum',
  portalUrl: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  schemaShape: 'ethereum',
  features: { withdrawals: true, uncles: false },
}

export const polygon: EvmChain = {
  id: 'polygon',
  portalUrl: 'https://portal.sqd.dev/datasets/polygon-mainnet',
  schemaShape: 'standard',
  features: { withdrawals: false, uncles: true },
}
