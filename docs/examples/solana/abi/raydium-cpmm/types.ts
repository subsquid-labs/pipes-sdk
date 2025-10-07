import { address, bool, Codec, fixedArray, struct, sum, u8, u16, u64, u128, unit } from '@subsquid/borsh'

export interface Observation {
  /**
   * The block timestamp of the observation
   */
  blockTimestamp: bigint
  /**
   * the cumulative of token0 price during the duration time, Q32.32, the remaining 64 bit for overflow
   */
  cumulativeToken0PriceX32: bigint
  /**
   * the cumulative of token1 price during the duration time, Q32.32, the remaining 64 bit for overflow
   */
  cumulativeToken1PriceX32: bigint
}

export const Observation: Codec<Observation> = struct({
  /**
   * The block timestamp of the observation
   */
  blockTimestamp: u64,
  /**
   * the cumulative of token0 price during the duration time, Q32.32, the remaining 64 bit for overflow
   */
  cumulativeToken0PriceX32: u128,
  /**
   * the cumulative of token1 price during the duration time, Q32.32, the remaining 64 bit for overflow
   */
  cumulativeToken1PriceX32: u128,
})

export type TradeDirection_ZeroForOne = undefined

export const TradeDirection_ZeroForOne = unit

export type TradeDirection_OneForZero = undefined

export const TradeDirection_OneForZero = unit

export type TradeDirection =
  | {
      kind: 'ZeroForOne'
      value?: TradeDirection_ZeroForOne
    }
  | {
      kind: 'OneForZero'
      value?: TradeDirection_OneForZero
    }

export const TradeDirection: Codec<TradeDirection> = sum(1, {
  ZeroForOne: {
    discriminator: 0,
    value: TradeDirection_ZeroForOne,
  },
  OneForZero: {
    discriminator: 1,
    value: TradeDirection_OneForZero,
  },
})

export type RoundDirection_Floor = undefined

export const RoundDirection_Floor = unit

export type RoundDirection_Ceiling = undefined

export const RoundDirection_Ceiling = unit

export type RoundDirection =
  | {
      kind: 'Floor'
      value?: RoundDirection_Floor
    }
  | {
      kind: 'Ceiling'
      value?: RoundDirection_Ceiling
    }

export const RoundDirection: Codec<RoundDirection> = sum(1, {
  Floor: {
    discriminator: 0,
    value: RoundDirection_Floor,
  },
  Ceiling: {
    discriminator: 1,
    value: RoundDirection_Ceiling,
  },
})

export type PoolStatusBitIndex_Deposit = undefined

export const PoolStatusBitIndex_Deposit = unit

export type PoolStatusBitIndex_Withdraw = undefined

export const PoolStatusBitIndex_Withdraw = unit

export type PoolStatusBitIndex_Swap = undefined

export const PoolStatusBitIndex_Swap = unit

export type PoolStatusBitIndex =
  | {
      kind: 'Deposit'
      value?: PoolStatusBitIndex_Deposit
    }
  | {
      kind: 'Withdraw'
      value?: PoolStatusBitIndex_Withdraw
    }
  | {
      kind: 'Swap'
      value?: PoolStatusBitIndex_Swap
    }

export const PoolStatusBitIndex: Codec<PoolStatusBitIndex> = sum(1, {
  Deposit: {
    discriminator: 0,
    value: PoolStatusBitIndex_Deposit,
  },
  Withdraw: {
    discriminator: 1,
    value: PoolStatusBitIndex_Withdraw,
  },
  Swap: {
    discriminator: 2,
    value: PoolStatusBitIndex_Swap,
  },
})

export type PoolStatusBitFlag_Enable = undefined

export const PoolStatusBitFlag_Enable = unit

export type PoolStatusBitFlag_Disable = undefined

export const PoolStatusBitFlag_Disable = unit

export type PoolStatusBitFlag =
  | {
      kind: 'Enable'
      value?: PoolStatusBitFlag_Enable
    }
  | {
      kind: 'Disable'
      value?: PoolStatusBitFlag_Disable
    }

export const PoolStatusBitFlag: Codec<PoolStatusBitFlag> = sum(1, {
  Enable: {
    discriminator: 0,
    value: PoolStatusBitFlag_Enable,
  },
  Disable: {
    discriminator: 1,
    value: PoolStatusBitFlag_Disable,
  },
})

export interface AmmConfig {
  /**
   * Bump to identify PDA
   */
  bump: number
  /**
   * Status to control if new pool can be create
   */
  disableCreatePool: boolean
  /**
   * Config index
   */
  index: number
  /**
   * The trade fee, denominated in hundredths of a bip (10^-6)
   */
  tradeFeeRate: bigint
  /**
   * The protocol fee
   */
  protocolFeeRate: bigint
  /**
   * The fund fee, denominated in hundredths of a bip (10^-6)
   */
  fundFeeRate: bigint
  /**
   * Fee for create a new pool
   */
  createPoolFee: bigint
  /**
   * Address of the protocol fee owner
   */
  protocolOwner: string
  /**
   * Address of the fund fee owner
   */
  fundOwner: string
  /**
   * padding
   */
  padding: Array<bigint>
}

export const AmmConfig: Codec<AmmConfig> = struct({
  /**
   * Bump to identify PDA
   */
  bump: u8,
  /**
   * Status to control if new pool can be create
   */
  disableCreatePool: bool,
  /**
   * Config index
   */
  index: u16,
  /**
   * The trade fee, denominated in hundredths of a bip (10^-6)
   */
  tradeFeeRate: u64,
  /**
   * The protocol fee
   */
  protocolFeeRate: u64,
  /**
   * The fund fee, denominated in hundredths of a bip (10^-6)
   */
  fundFeeRate: u64,
  /**
   * Fee for create a new pool
   */
  createPoolFee: u64,
  /**
   * Address of the protocol fee owner
   */
  protocolOwner: address,
  /**
   * Address of the fund fee owner
   */
  fundOwner: address,
  /**
   * padding
   */
  padding: fixedArray(u64, 16),
})

export interface ObservationState {
  /**
   * Whether the ObservationState is initialized
   */
  initialized: boolean
  /**
   * the most-recently updated index of the observations array
   */
  observationIndex: number
  poolId: string
  /**
   * observation array
   */
  observations: Array<Observation>
  /**
   * padding for feature update
   */
  padding: Array<bigint>
}

export const ObservationState: Codec<ObservationState> = struct({
  /**
   * Whether the ObservationState is initialized
   */
  initialized: bool,
  /**
   * the most-recently updated index of the observations array
   */
  observationIndex: u16,
  poolId: address,
  /**
   * observation array
   */
  observations: fixedArray(Observation, 100),
  /**
   * padding for feature update
   */
  padding: fixedArray(u64, 4),
})

export interface PoolState {
  /**
   * Which config the pool belongs
   */
  ammConfig: string
  /**
   * pool creator
   */
  poolCreator: string
  /**
   * Token A
   */
  token0Vault: string
  /**
   * Token B
   */
  token1Vault: string
  /**
   * Pool tokens are issued when A or B tokens are deposited.
   * Pool tokens can be withdrawn back to the original A or B token.
   */
  lpMint: string
  /**
   * Mint information for token A
   */
  token0Mint: string
  /**
   * Mint information for token B
   */
  token1Mint: string
  /**
   * token_0 program
   */
  token0Program: string
  /**
   * token_1 program
   */
  token1Program: string
  /**
   * observation account to store oracle data
   */
  observationKey: string
  authBump: number
  /**
   * Bitwise representation of the state of the pool
   * bit0, 1: disable deposit(vaule is 1), 0: normal
   * bit1, 1: disable withdraw(vaule is 2), 0: normal
   * bit2, 1: disable swap(vaule is 4), 0: normal
   */
  status: number
  lpMintDecimals: number
  /**
   * mint0 and mint1 decimals
   */
  mint0Decimals: number
  mint1Decimals: number
  /**
   * lp mint supply
   */
  lpSupply: bigint
  /**
   * The amounts of token_0 and token_1 that are owed to the liquidity provider.
   */
  protocolFeesToken0: bigint
  protocolFeesToken1: bigint
  fundFeesToken0: bigint
  fundFeesToken1: bigint
  /**
   * The timestamp allowed for swap in the pool.
   */
  openTime: bigint
  /**
   * padding for future updates
   */
  padding: Array<bigint>
}

export const PoolState: Codec<PoolState> = struct({
  /**
   * Which config the pool belongs
   */
  ammConfig: address,
  /**
   * pool creator
   */
  poolCreator: address,
  /**
   * Token A
   */
  token0Vault: address,
  /**
   * Token B
   */
  token1Vault: address,
  /**
   * Pool tokens are issued when A or B tokens are deposited.
   * Pool tokens can be withdrawn back to the original A or B token.
   */
  lpMint: address,
  /**
   * Mint information for token A
   */
  token0Mint: address,
  /**
   * Mint information for token B
   */
  token1Mint: address,
  /**
   * token_0 program
   */
  token0Program: address,
  /**
   * token_1 program
   */
  token1Program: address,
  /**
   * observation account to store oracle data
   */
  observationKey: address,
  authBump: u8,
  /**
   * Bitwise representation of the state of the pool
   * bit0, 1: disable deposit(vaule is 1), 0: normal
   * bit1, 1: disable withdraw(vaule is 2), 0: normal
   * bit2, 1: disable swap(vaule is 4), 0: normal
   */
  status: u8,
  lpMintDecimals: u8,
  /**
   * mint0 and mint1 decimals
   */
  mint0Decimals: u8,
  mint1Decimals: u8,
  /**
   * lp mint supply
   */
  lpSupply: u64,
  /**
   * The amounts of token_0 and token_1 that are owed to the liquidity provider.
   */
  protocolFeesToken0: u64,
  protocolFeesToken1: u64,
  fundFeesToken0: u64,
  fundFeesToken1: u64,
  /**
   * The timestamp allowed for swap in the pool.
   */
  openTime: u64,
  /**
   * padding for future updates
   */
  padding: fixedArray(u64, 32),
})

export interface LpChangeEvent {
  poolId: string
  lpAmountBefore: bigint
  token0VaultBefore: bigint
  token1VaultBefore: bigint
  token0Amount: bigint
  token1Amount: bigint
  token0TransferFee: bigint
  token1TransferFee: bigint
  changeType: number
}

export const LpChangeEvent: Codec<LpChangeEvent> = struct({
  poolId: address,
  lpAmountBefore: u64,
  token0VaultBefore: u64,
  token1VaultBefore: u64,
  token0Amount: u64,
  token1Amount: u64,
  token0TransferFee: u64,
  token1TransferFee: u64,
  changeType: u8,
})

export interface SwapEvent {
  poolId: string
  inputVaultBefore: bigint
  outputVaultBefore: bigint
  inputAmount: bigint
  outputAmount: bigint
  inputTransferFee: bigint
  outputTransferFee: bigint
  baseInput: boolean
}

export const SwapEvent: Codec<SwapEvent> = struct({
  poolId: address,
  inputVaultBefore: u64,
  outputVaultBefore: u64,
  inputAmount: u64,
  outputAmount: u64,
  inputTransferFee: u64,
  outputTransferFee: u64,
  baseInput: bool,
})
