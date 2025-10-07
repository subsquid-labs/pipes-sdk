import { address, array, bool, i32, option, struct, u8, u16, u32, u64, u128, unit } from '@subsquid/borsh'
import { instruction } from '../abi.support.js'
import { InitializeRewardParam } from './types.js'

export interface CreateAmmConfig {
  index: number
  tickSpacing: number
  tradeFeeRate: number
  protocolFeeRate: number
  fundFeeRate: number
}

export const createAmmConfig = instruction(
  {
    d8: '0x8934edd4d7756c68',
  },
  {
    owner: 0,
    ammConfig: 1,
    systemProgram: 2,
  },
  struct({
    index: u16,
    tickSpacing: u16,
    tradeFeeRate: u32,
    protocolFeeRate: u32,
    fundFeeRate: u32,
  }),
)

export interface UpdateAmmConfig {
  param: number
  value: number
}

export const updateAmmConfig = instruction(
  {
    d8: '0x313cae889a1c74c8',
  },
  {
    owner: 0,
    ammConfig: 1,
  },
  struct({
    param: u8,
    value: u32,
  }),
)

export interface CreatePool {
  sqrtPriceX64: bigint
  openTime: bigint
}

export const createPool = instruction(
  {
    d8: '0xe992d18ecf6840bc',
  },
  {
    poolCreator: 0,
    ammConfig: 1,
    poolState: 2,
    tokenMint0: 3,
    tokenMint1: 4,
    tokenVault0: 5,
    tokenVault1: 6,
    observationState: 7,
    tickArrayBitmap: 8,
    tokenProgram0: 9,
    tokenProgram1: 10,
    systemProgram: 11,
    rent: 12,
  },
  struct({
    sqrtPriceX64: u128,
    openTime: u64,
  }),
)

export interface UpdatePoolStatus {
  status: number
}

export const updatePoolStatus = instruction(
  {
    d8: '0x82576c062ee0757b',
  },
  {
    authority: 0,
    poolState: 1,
  },
  struct({
    status: u8,
  }),
)

export type CreateOperationAccount = undefined

export const createOperationAccount = instruction(
  {
    d8: '0x3f5794216d230868',
  },
  {
    owner: 0,
    operationState: 1,
    systemProgram: 2,
  },
  unit,
)

export interface UpdateOperationAccount {
  param: number
  keys: Array<string>
}

export const updateOperationAccount = instruction(
  {
    d8: '0x7f467728bce33d07',
  },
  {
    owner: 0,
    operationState: 1,
    systemProgram: 2,
  },
  struct({
    param: u8,
    keys: array(address),
  }),
)

export interface TransferRewardOwner {
  newOwner: string
}

export const transferRewardOwner = instruction(
  {
    d8: '0x07160c53f22b3079',
  },
  {
    authority: 0,
    poolState: 1,
  },
  struct({
    newOwner: address,
  }),
)

export interface InitializeReward {
  param: InitializeRewardParam
}

export const initializeReward = instruction(
  {
    d8: '0x5f87c0c4f281e644',
  },
  {
    rewardFunder: 0,
    funderTokenAccount: 1,
    ammConfig: 2,
    poolState: 3,
    operationState: 4,
    rewardTokenMint: 5,
    rewardTokenVault: 6,
    rewardTokenProgram: 7,
    systemProgram: 8,
    rent: 9,
  },
  struct({
    param: InitializeRewardParam,
  }),
)

export interface CollectRemainingRewards {
  rewardIndex: number
}

export const collectRemainingRewards = instruction(
  {
    d8: '0x12eda6c52210d590',
  },
  {
    rewardFunder: 0,
    funderTokenAccount: 1,
    poolState: 2,
    rewardTokenVault: 3,
    rewardVaultMint: 4,
    tokenProgram: 5,
    tokenProgram2022: 6,
    memoProgram: 7,
  },
  struct({
    rewardIndex: u8,
  }),
)

export type UpdateRewardInfos = undefined

export const updateRewardInfos = instruction(
  {
    d8: '0xa3ace0340b9a6adf',
  },
  {
    poolState: 0,
  },
  unit,
)

export interface SetRewardParams {
  rewardIndex: number
  emissionsPerSecondX64: bigint
  openTime: bigint
  endTime: bigint
}

export const setRewardParams = instruction(
  {
    d8: '0x7034a74b20c9d389',
  },
  {
    authority: 0,
    ammConfig: 1,
    poolState: 2,
    operationState: 3,
    tokenProgram: 4,
    tokenProgram2022: 5,
  },
  struct({
    rewardIndex: u8,
    emissionsPerSecondX64: u128,
    openTime: u64,
    endTime: u64,
  }),
)

export interface CollectProtocolFee {
  amount0Requested: bigint
  amount1Requested: bigint
}

export const collectProtocolFee = instruction(
  {
    d8: '0x8888fcddc2427e59',
  },
  {
    owner: 0,
    poolState: 1,
    ammConfig: 2,
    tokenVault0: 3,
    tokenVault1: 4,
    vault0Mint: 5,
    vault1Mint: 6,
    recipientTokenAccount0: 7,
    recipientTokenAccount1: 8,
    tokenProgram: 9,
    tokenProgram2022: 10,
  },
  struct({
    amount0Requested: u64,
    amount1Requested: u64,
  }),
)

export interface CollectFundFee {
  amount0Requested: bigint
  amount1Requested: bigint
}

export const collectFundFee = instruction(
  {
    d8: '0xa78a4e95dfc2067e',
  },
  {
    owner: 0,
    poolState: 1,
    ammConfig: 2,
    tokenVault0: 3,
    tokenVault1: 4,
    vault0Mint: 5,
    vault1Mint: 6,
    recipientTokenAccount0: 7,
    recipientTokenAccount1: 8,
    tokenProgram: 9,
    tokenProgram2022: 10,
  },
  struct({
    amount0Requested: u64,
    amount1Requested: u64,
  }),
)

export interface OpenPosition {
  tickLowerIndex: number
  tickUpperIndex: number
  tickArrayLowerStartIndex: number
  tickArrayUpperStartIndex: number
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
}

export const openPosition = instruction(
  {
    d8: '0x87802f4d0f98f031',
  },
  {
    payer: 0,
    positionNftOwner: 1,
    positionNftMint: 2,
    positionNftAccount: 3,
    metadataAccount: 4,
    poolState: 5,
    protocolPosition: 6,
    tickArrayLower: 7,
    tickArrayUpper: 8,
    personalPosition: 9,
    tokenAccount0: 10,
    tokenAccount1: 11,
    tokenVault0: 12,
    tokenVault1: 13,
    rent: 14,
    systemProgram: 15,
    tokenProgram: 16,
    associatedTokenProgram: 17,
    metadataProgram: 18,
  },
  struct({
    tickLowerIndex: i32,
    tickUpperIndex: i32,
    tickArrayLowerStartIndex: i32,
    tickArrayUpperStartIndex: i32,
    liquidity: u128,
    amount0Max: u64,
    amount1Max: u64,
  }),
)

export interface OpenPositionV2 {
  tickLowerIndex: number
  tickUpperIndex: number
  tickArrayLowerStartIndex: number
  tickArrayUpperStartIndex: number
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
  withMetadata: boolean
  baseFlag?: boolean | undefined
}

export const openPositionV2 = instruction(
  {
    d8: '0x4db84ad67056f1c7',
  },
  {
    payer: 0,
    positionNftOwner: 1,
    positionNftMint: 2,
    positionNftAccount: 3,
    metadataAccount: 4,
    poolState: 5,
    protocolPosition: 6,
    tickArrayLower: 7,
    tickArrayUpper: 8,
    personalPosition: 9,
    tokenAccount0: 10,
    tokenAccount1: 11,
    tokenVault0: 12,
    tokenVault1: 13,
    rent: 14,
    systemProgram: 15,
    tokenProgram: 16,
    associatedTokenProgram: 17,
    metadataProgram: 18,
    tokenProgram2022: 19,
    vault0Mint: 20,
    vault1Mint: 21,
  },
  struct({
    tickLowerIndex: i32,
    tickUpperIndex: i32,
    tickArrayLowerStartIndex: i32,
    tickArrayUpperStartIndex: i32,
    liquidity: u128,
    amount0Max: u64,
    amount1Max: u64,
    withMetadata: bool,
    baseFlag: option(bool),
  }),
)

export interface OpenPositionWithToken22Nft {
  tickLowerIndex: number
  tickUpperIndex: number
  tickArrayLowerStartIndex: number
  tickArrayUpperStartIndex: number
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
  withMetadata: boolean
  baseFlag?: boolean | undefined
}

export const openPositionWithToken22Nft = instruction(
  {
    d8: '0x4dffae527d1dc92e',
  },
  {
    payer: 0,
    positionNftOwner: 1,
    positionNftMint: 2,
    positionNftAccount: 3,
    poolState: 4,
    protocolPosition: 5,
    tickArrayLower: 6,
    tickArrayUpper: 7,
    personalPosition: 8,
    tokenAccount0: 9,
    tokenAccount1: 10,
    tokenVault0: 11,
    tokenVault1: 12,
    rent: 13,
    systemProgram: 14,
    tokenProgram: 15,
    associatedTokenProgram: 16,
    tokenProgram2022: 17,
    vault0Mint: 18,
    vault1Mint: 19,
  },
  struct({
    tickLowerIndex: i32,
    tickUpperIndex: i32,
    tickArrayLowerStartIndex: i32,
    tickArrayUpperStartIndex: i32,
    liquidity: u128,
    amount0Max: u64,
    amount1Max: u64,
    withMetadata: bool,
    baseFlag: option(bool),
  }),
)

export type ClosePosition = undefined

export const closePosition = instruction(
  {
    d8: '0x7b86510031446262',
  },
  {
    nftOwner: 0,
    positionNftMint: 1,
    positionNftAccount: 2,
    personalPosition: 3,
    systemProgram: 4,
    tokenProgram: 5,
  },
  unit,
)

export interface IncreaseLiquidity {
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
}

export const increaseLiquidity = instruction(
  {
    d8: '0x2e9cf3760dcdfbb2',
  },
  {
    nftOwner: 0,
    nftAccount: 1,
    poolState: 2,
    protocolPosition: 3,
    personalPosition: 4,
    tickArrayLower: 5,
    tickArrayUpper: 6,
    tokenAccount0: 7,
    tokenAccount1: 8,
    tokenVault0: 9,
    tokenVault1: 10,
    tokenProgram: 11,
  },
  struct({
    liquidity: u128,
    amount0Max: u64,
    amount1Max: u64,
  }),
)

export interface IncreaseLiquidityV2 {
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
  baseFlag?: boolean | undefined
}

export const increaseLiquidityV2 = instruction(
  {
    d8: '0x851d59df45eeb00a',
  },
  {
    nftOwner: 0,
    nftAccount: 1,
    poolState: 2,
    protocolPosition: 3,
    personalPosition: 4,
    tickArrayLower: 5,
    tickArrayUpper: 6,
    tokenAccount0: 7,
    tokenAccount1: 8,
    tokenVault0: 9,
    tokenVault1: 10,
    tokenProgram: 11,
    tokenProgram2022: 12,
    vault0Mint: 13,
    vault1Mint: 14,
  },
  struct({
    liquidity: u128,
    amount0Max: u64,
    amount1Max: u64,
    baseFlag: option(bool),
  }),
)

export interface DecreaseLiquidity {
  liquidity: bigint
  amount0Min: bigint
  amount1Min: bigint
}

export const decreaseLiquidity = instruction(
  {
    d8: '0xa026d06f685b2c01',
  },
  {
    nftOwner: 0,
    nftAccount: 1,
    personalPosition: 2,
    poolState: 3,
    protocolPosition: 4,
    tokenVault0: 5,
    tokenVault1: 6,
    tickArrayLower: 7,
    tickArrayUpper: 8,
    recipientTokenAccount0: 9,
    recipientTokenAccount1: 10,
    tokenProgram: 11,
  },
  struct({
    liquidity: u128,
    amount0Min: u64,
    amount1Min: u64,
  }),
)

export interface DecreaseLiquidityV2 {
  liquidity: bigint
  amount0Min: bigint
  amount1Min: bigint
}

export const decreaseLiquidityV2 = instruction(
  {
    d8: '0x3a7fbc3e4f52c460',
  },
  {
    nftOwner: 0,
    nftAccount: 1,
    personalPosition: 2,
    poolState: 3,
    protocolPosition: 4,
    tokenVault0: 5,
    tokenVault1: 6,
    tickArrayLower: 7,
    tickArrayUpper: 8,
    recipientTokenAccount0: 9,
    recipientTokenAccount1: 10,
    tokenProgram: 11,
    tokenProgram2022: 12,
    memoProgram: 13,
    vault0Mint: 14,
    vault1Mint: 15,
  },
  struct({
    liquidity: u128,
    amount0Min: u64,
    amount1Min: u64,
  }),
)

export interface Swap {
  amount: bigint
  otherAmountThreshold: bigint
  sqrtPriceLimitX64: bigint
  isBaseInput: boolean
}

export const swap = instruction(
  {
    d8: '0xf8c69e91e17587c8',
  },
  {
    payer: 0,
    ammConfig: 1,
    poolState: 2,
    inputTokenAccount: 3,
    outputTokenAccount: 4,
    inputVault: 5,
    outputVault: 6,
    observationState: 7,
    tokenProgram: 8,
    tickArray: 9,
  },
  struct({
    amount: u64,
    otherAmountThreshold: u64,
    sqrtPriceLimitX64: u128,
    isBaseInput: bool,
  }),
)

export interface SwapV2 {
  amount: bigint
  otherAmountThreshold: bigint
  sqrtPriceLimitX64: bigint
  isBaseInput: boolean
}

export const swapV2 = instruction(
  {
    d8: '0x2b04ed0b1ac91e62',
  },
  {
    payer: 0,
    ammConfig: 1,
    poolState: 2,
    inputTokenAccount: 3,
    outputTokenAccount: 4,
    inputVault: 5,
    outputVault: 6,
    observationState: 7,
    tokenProgram: 8,
    tokenProgram2022: 9,
    memoProgram: 10,
    inputVaultMint: 11,
    outputVaultMint: 12,
  },
  struct({
    amount: u64,
    otherAmountThreshold: u64,
    sqrtPriceLimitX64: u128,
    isBaseInput: bool,
  }),
)

export interface SwapRouterBaseIn {
  amountIn: bigint
  amountOutMinimum: bigint
}

export const swapRouterBaseIn = instruction(
  {
    d8: '0x457d73daf5baf2c4',
  },
  {
    payer: 0,
    inputTokenAccount: 1,
    inputTokenMint: 2,
    tokenProgram: 3,
    tokenProgram2022: 4,
    memoProgram: 5,
  },
  struct({
    amountIn: u64,
    amountOutMinimum: u64,
  }),
)
