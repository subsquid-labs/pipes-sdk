import {
  address,
  bool,
  Codec,
  fixedArray,
  i32,
  i64,
  i128,
  ref,
  struct,
  sum,
  u8,
  u16,
  u32,
  u64,
  u128,
  unit,
} from '@subsquid/borsh'

export interface InitializeRewardParam {
  openTime: bigint
  endTime: bigint
  emissionsPerSecondX64: bigint
}

export const InitializeRewardParam: Codec<InitializeRewardParam> = struct({
  openTime: u64,
  endTime: u64,
  emissionsPerSecondX64: u128,
})

export interface Observation {
  blockTimestamp: number
  tickCumulative: bigint
  padding: Array<bigint>
}

export const Observation: Codec<Observation> = struct({
  blockTimestamp: u32,
  tickCumulative: i64,
  padding: fixedArray(u64, 4),
})

export interface PositionRewardInfo {
  growthInsideLastX64: bigint
  rewardAmountOwed: bigint
}

export const PositionRewardInfo: Codec<PositionRewardInfo> = struct({
  growthInsideLastX64: u128,
  rewardAmountOwed: u64,
})

export interface RewardInfo {
  rewardState: number
  openTime: bigint
  endTime: bigint
  lastUpdateTime: bigint
  emissionsPerSecondX64: bigint
  rewardTotalEmissioned: bigint
  rewardClaimed: bigint
  tokenMint: string
  tokenVault: string
  authority: string
  rewardGrowthGlobalX64: bigint
}

export const RewardInfo: Codec<RewardInfo> = struct({
  rewardState: u8,
  openTime: u64,
  endTime: u64,
  lastUpdateTime: u64,
  emissionsPerSecondX64: u128,
  rewardTotalEmissioned: u64,
  rewardClaimed: u64,
  tokenMint: address,
  tokenVault: address,
  authority: address,
  rewardGrowthGlobalX64: u128,
})

export interface TickState {
  tick: number
  liquidityNet: bigint
  liquidityGross: bigint
  feeGrowthOutside0X64: bigint
  feeGrowthOutside1X64: bigint
  rewardGrowthsOutsideX64: Array<bigint>
  padding: Array<number>
}

export const TickState: Codec<TickState> = struct({
  tick: i32,
  liquidityNet: i128,
  liquidityGross: u128,
  feeGrowthOutside0X64: u128,
  feeGrowthOutside1X64: u128,
  rewardGrowthsOutsideX64: fixedArray(u128, 3),
  padding: fixedArray(u32, 13),
})

export type PoolStatusBitIndex_OpenPositionOrIncreaseLiquidity = undefined

export const PoolStatusBitIndex_OpenPositionOrIncreaseLiquidity = unit

export type PoolStatusBitIndex_DecreaseLiquidity = undefined

export const PoolStatusBitIndex_DecreaseLiquidity = unit

export type PoolStatusBitIndex_CollectFee = undefined

export const PoolStatusBitIndex_CollectFee = unit

export type PoolStatusBitIndex_CollectReward = undefined

export const PoolStatusBitIndex_CollectReward = unit

export type PoolStatusBitIndex_Swap = undefined

export const PoolStatusBitIndex_Swap = unit

export type PoolStatusBitIndex =
  | {
      kind: 'OpenPositionOrIncreaseLiquidity'
      value?: PoolStatusBitIndex_OpenPositionOrIncreaseLiquidity
    }
  | {
      kind: 'DecreaseLiquidity'
      value?: PoolStatusBitIndex_DecreaseLiquidity
    }
  | {
      kind: 'CollectFee'
      value?: PoolStatusBitIndex_CollectFee
    }
  | {
      kind: 'CollectReward'
      value?: PoolStatusBitIndex_CollectReward
    }
  | {
      kind: 'Swap'
      value?: PoolStatusBitIndex_Swap
    }

export const PoolStatusBitIndex: Codec<PoolStatusBitIndex> = sum(1, {
  OpenPositionOrIncreaseLiquidity: {
    discriminator: 0,
    value: PoolStatusBitIndex_OpenPositionOrIncreaseLiquidity,
  },
  DecreaseLiquidity: {
    discriminator: 1,
    value: PoolStatusBitIndex_DecreaseLiquidity,
  },
  CollectFee: {
    discriminator: 2,
    value: PoolStatusBitIndex_CollectFee,
  },
  CollectReward: {
    discriminator: 3,
    value: PoolStatusBitIndex_CollectReward,
  },
  Swap: {
    discriminator: 4,
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

export type RewardState_Uninitialized = undefined

export const RewardState_Uninitialized = unit

export type RewardState_Initialized = undefined

export const RewardState_Initialized = unit

export type RewardState_Opening = undefined

export const RewardState_Opening = unit

export type RewardState_Ended = undefined

export const RewardState_Ended = unit

export type RewardState =
  | {
      kind: 'Uninitialized'
      value?: RewardState_Uninitialized
    }
  | {
      kind: 'Initialized'
      value?: RewardState_Initialized
    }
  | {
      kind: 'Opening'
      value?: RewardState_Opening
    }
  | {
      kind: 'Ended'
      value?: RewardState_Ended
    }

export const RewardState: Codec<RewardState> = sum(1, {
  Uninitialized: {
    discriminator: 0,
    value: RewardState_Uninitialized,
  },
  Initialized: {
    discriminator: 1,
    value: RewardState_Initialized,
  },
  Opening: {
    discriminator: 2,
    value: RewardState_Opening,
  },
  Ended: {
    discriminator: 3,
    value: RewardState_Ended,
  },
})

export type TickArryBitmap = Array<bigint>

export const TickArryBitmap: Codec<TickArryBitmap> = fixedArray(u64, 8)

export interface AmmConfig {
  bump: number
  index: number
  owner: string
  protocolFeeRate: number
  tradeFeeRate: number
  tickSpacing: number
  fundFeeRate: number
  paddingU32: number
  fundOwner: string
  padding: Array<bigint>
}

export const AmmConfig: Codec<AmmConfig> = struct({
  bump: u8,
  index: u16,
  owner: address,
  protocolFeeRate: u32,
  tradeFeeRate: u32,
  tickSpacing: u16,
  fundFeeRate: u32,
  paddingU32: u32,
  fundOwner: address,
  padding: fixedArray(u64, 3),
})

export interface OperationState {
  bump: number
  operationOwners: Array<string>
  whitelistMints: Array<string>
}

export const OperationState: Codec<OperationState> = struct({
  bump: u8,
  operationOwners: fixedArray(address, 10),
  whitelistMints: fixedArray(address, 100),
})

export interface ObservationState {
  initialized: boolean
  recentEpoch: bigint
  observationIndex: number
  poolId: string
  observations: Array<Observation>
  padding: Array<bigint>
}

export const ObservationState: Codec<ObservationState> = struct({
  initialized: bool,
  recentEpoch: u64,
  observationIndex: u16,
  poolId: address,
  observations: fixedArray(
    ref(() => Observation),
    100,
  ),
  padding: fixedArray(u64, 4),
})

export interface PersonalPositionState {
  bump: Array<number>
  nftMint: string
  poolId: string
  tickLowerIndex: number
  tickUpperIndex: number
  liquidity: bigint
  feeGrowthInside0LastX64: bigint
  feeGrowthInside1LastX64: bigint
  tokenFeesOwed0: bigint
  tokenFeesOwed1: bigint
  rewardInfos: Array<PositionRewardInfo>
  recentEpoch: bigint
  padding: Array<bigint>
}

export const PersonalPositionState: Codec<PersonalPositionState> = struct({
  bump: fixedArray(u8, 1),
  nftMint: address,
  poolId: address,
  tickLowerIndex: i32,
  tickUpperIndex: i32,
  liquidity: u128,
  feeGrowthInside0LastX64: u128,
  feeGrowthInside1LastX64: u128,
  tokenFeesOwed0: u64,
  tokenFeesOwed1: u64,
  rewardInfos: fixedArray(
    ref(() => PositionRewardInfo),
    3,
  ),
  recentEpoch: u64,
  padding: fixedArray(u64, 7),
})

export interface PoolState {
  bump: Array<number>
  ammConfig: string
  owner: string
  tokenMint0: string
  tokenMint1: string
  tokenVault0: string
  tokenVault1: string
  observationKey: string
  mintDecimals0: number
  mintDecimals1: number
  tickSpacing: number
  liquidity: bigint
  sqrtPriceX64: bigint
  tickCurrent: number
  padding3: number
  padding4: number
  feeGrowthGlobal0X64: bigint
  feeGrowthGlobal1X64: bigint
  protocolFeesToken0: bigint
  protocolFeesToken1: bigint
  swapInAmountToken0: bigint
  swapOutAmountToken1: bigint
  swapInAmountToken1: bigint
  swapOutAmountToken0: bigint
  status: number
  padding: Array<number>
  rewardInfos: Array<RewardInfo>
  tickArrayBitmap: Array<bigint>
  totalFeesToken0: bigint
  totalFeesClaimedToken0: bigint
  totalFeesToken1: bigint
  totalFeesClaimedToken1: bigint
  fundFeesToken0: bigint
  fundFeesToken1: bigint
  openTime: bigint
  recentEpoch: bigint
  padding1: Array<bigint>
  padding2: Array<bigint>
}

export const PoolState: Codec<PoolState> = struct({
  bump: fixedArray(u8, 1),
  ammConfig: address,
  owner: address,
  tokenMint0: address,
  tokenMint1: address,
  tokenVault0: address,
  tokenVault1: address,
  observationKey: address,
  mintDecimals0: u8,
  mintDecimals1: u8,
  tickSpacing: u16,
  liquidity: u128,
  sqrtPriceX64: u128,
  tickCurrent: i32,
  padding3: u16,
  padding4: u16,
  feeGrowthGlobal0X64: u128,
  feeGrowthGlobal1X64: u128,
  protocolFeesToken0: u64,
  protocolFeesToken1: u64,
  swapInAmountToken0: u128,
  swapOutAmountToken1: u128,
  swapInAmountToken1: u128,
  swapOutAmountToken0: u128,
  status: u8,
  padding: fixedArray(u8, 7),
  rewardInfos: fixedArray(
    ref(() => RewardInfo),
    3,
  ),
  tickArrayBitmap: fixedArray(u64, 16),
  totalFeesToken0: u64,
  totalFeesClaimedToken0: u64,
  totalFeesToken1: u64,
  totalFeesClaimedToken1: u64,
  fundFeesToken0: u64,
  fundFeesToken1: u64,
  openTime: u64,
  recentEpoch: u64,
  padding1: fixedArray(u64, 24),
  padding2: fixedArray(u64, 32),
})

export interface ProtocolPositionState {
  bump: number
  poolId: string
  tickLowerIndex: number
  tickUpperIndex: number
  liquidity: bigint
  feeGrowthInside0LastX64: bigint
  feeGrowthInside1LastX64: bigint
  tokenFeesOwed0: bigint
  tokenFeesOwed1: bigint
  rewardGrowthInside: Array<bigint>
  recentEpoch: bigint
  padding: Array<bigint>
}

export const ProtocolPositionState: Codec<ProtocolPositionState> = struct({
  bump: u8,
  poolId: address,
  tickLowerIndex: i32,
  tickUpperIndex: i32,
  liquidity: u128,
  feeGrowthInside0LastX64: u128,
  feeGrowthInside1LastX64: u128,
  tokenFeesOwed0: u64,
  tokenFeesOwed1: u64,
  rewardGrowthInside: fixedArray(u128, 3),
  recentEpoch: u64,
  padding: fixedArray(u64, 7),
})

export interface TickArrayState {
  poolId: string
  startTickIndex: number
  ticks: Array<TickState>
  initializedTickCount: number
  recentEpoch: bigint
  padding: Array<number>
}

export const TickArrayState: Codec<TickArrayState> = struct({
  poolId: address,
  startTickIndex: i32,
  ticks: fixedArray(
    ref(() => TickState),
    60,
  ),
  initializedTickCount: u8,
  recentEpoch: u64,
  padding: fixedArray(u8, 107),
})

export interface TickArrayBitmapExtension {
  poolId: string
  positiveTickArrayBitmap: Array<Array<bigint>>
  negativeTickArrayBitmap: Array<Array<bigint>>
}

export const TickArrayBitmapExtension: Codec<TickArrayBitmapExtension> = struct({
  poolId: address,
  positiveTickArrayBitmap: fixedArray(fixedArray(u64, 8), 14),
  negativeTickArrayBitmap: fixedArray(fixedArray(u64, 8), 14),
})

export interface ConfigChangeEvent {
  index: number
  owner: string
  protocolFeeRate: number
  tradeFeeRate: number
  tickSpacing: number
  fundFeeRate: number
  fundOwner: string
}

export const ConfigChangeEvent: Codec<ConfigChangeEvent> = struct({
  index: u16,
  owner: address,
  protocolFeeRate: u32,
  tradeFeeRate: u32,
  tickSpacing: u16,
  fundFeeRate: u32,
  fundOwner: address,
})

export interface CreatePersonalPositionEvent {
  poolState: string
  minter: string
  nftOwner: string
  tickLowerIndex: number
  tickUpperIndex: number
  liquidity: bigint
  depositAmount0: bigint
  depositAmount1: bigint
  depositAmount0TransferFee: bigint
  depositAmount1TransferFee: bigint
}

export const CreatePersonalPositionEvent: Codec<CreatePersonalPositionEvent> = struct({
  poolState: address,
  minter: address,
  nftOwner: address,
  tickLowerIndex: i32,
  tickUpperIndex: i32,
  liquidity: u128,
  depositAmount0: u64,
  depositAmount1: u64,
  depositAmount0TransferFee: u64,
  depositAmount1TransferFee: u64,
})

export interface IncreaseLiquidityEvent {
  positionNftMint: string
  liquidity: bigint
  amount0: bigint
  amount1: bigint
  amount0TransferFee: bigint
  amount1TransferFee: bigint
}

export const IncreaseLiquidityEvent: Codec<IncreaseLiquidityEvent> = struct({
  positionNftMint: address,
  liquidity: u128,
  amount0: u64,
  amount1: u64,
  amount0TransferFee: u64,
  amount1TransferFee: u64,
})

export interface DecreaseLiquidityEvent {
  positionNftMint: string
  liquidity: bigint
  decreaseAmount0: bigint
  decreaseAmount1: bigint
  feeAmount0: bigint
  feeAmount1: bigint
  rewardAmounts: Array<bigint>
  transferFee0: bigint
  transferFee1: bigint
}

export const DecreaseLiquidityEvent: Codec<DecreaseLiquidityEvent> = struct({
  positionNftMint: address,
  liquidity: u128,
  decreaseAmount0: u64,
  decreaseAmount1: u64,
  feeAmount0: u64,
  feeAmount1: u64,
  rewardAmounts: fixedArray(u64, 3),
  transferFee0: u64,
  transferFee1: u64,
})

export interface LiquidityCalculateEvent {
  poolLiquidity: bigint
  poolSqrtPriceX64: bigint
  poolTick: number
  calcAmount0: bigint
  calcAmount1: bigint
  tradeFeeOwed0: bigint
  tradeFeeOwed1: bigint
  transferFee0: bigint
  transferFee1: bigint
}

export const LiquidityCalculateEvent: Codec<LiquidityCalculateEvent> = struct({
  poolLiquidity: u128,
  poolSqrtPriceX64: u128,
  poolTick: i32,
  calcAmount0: u64,
  calcAmount1: u64,
  tradeFeeOwed0: u64,
  tradeFeeOwed1: u64,
  transferFee0: u64,
  transferFee1: u64,
})

export interface CollectPersonalFeeEvent {
  positionNftMint: string
  recipientTokenAccount0: string
  recipientTokenAccount1: string
  amount0: bigint
  amount1: bigint
}

export const CollectPersonalFeeEvent: Codec<CollectPersonalFeeEvent> = struct({
  positionNftMint: address,
  recipientTokenAccount0: address,
  recipientTokenAccount1: address,
  amount0: u64,
  amount1: u64,
})

export interface UpdateRewardInfosEvent {
  rewardGrowthGlobalX64: Array<bigint>
}

export const UpdateRewardInfosEvent: Codec<UpdateRewardInfosEvent> = struct({
  rewardGrowthGlobalX64: fixedArray(u128, 3),
})

export interface PoolCreatedEvent {
  tokenMint0: string
  tokenMint1: string
  tickSpacing: number
  poolState: string
  sqrtPriceX64: bigint
  tick: number
  tokenVault0: string
  tokenVault1: string
}

export const PoolCreatedEvent: Codec<PoolCreatedEvent> = struct({
  tokenMint0: address,
  tokenMint1: address,
  tickSpacing: u16,
  poolState: address,
  sqrtPriceX64: u128,
  tick: i32,
  tokenVault0: address,
  tokenVault1: address,
})

export interface CollectProtocolFeeEvent {
  poolState: string
  recipientTokenAccount0: string
  recipientTokenAccount1: string
  amount0: bigint
  amount1: bigint
}

export const CollectProtocolFeeEvent: Codec<CollectProtocolFeeEvent> = struct({
  poolState: address,
  recipientTokenAccount0: address,
  recipientTokenAccount1: address,
  amount0: u64,
  amount1: u64,
})

export interface SwapEvent {
  poolState: string
  sender: string
  tokenAccount0: string
  tokenAccount1: string
  amount0: bigint
  transferFee0: bigint
  amount1: bigint
  transferFee1: bigint
  zeroForOne: boolean
  sqrtPriceX64: bigint
  liquidity: bigint
  tick: number
}

export const SwapEvent: Codec<SwapEvent> = struct({
  poolState: address,
  sender: address,
  tokenAccount0: address,
  tokenAccount1: address,
  amount0: u64,
  transferFee0: u64,
  amount1: u64,
  transferFee1: u64,
  zeroForOne: bool,
  sqrtPriceX64: u128,
  liquidity: u128,
  tick: i32,
})

export interface LiquidityChangeEvent {
  poolState: string
  tick: number
  tickLower: number
  tickUpper: number
  liquidityBefore: bigint
  liquidityAfter: bigint
}

export const LiquidityChangeEvent: Codec<LiquidityChangeEvent> = struct({
  poolState: address,
  tick: i32,
  tickLower: i32,
  tickUpper: i32,
  liquidityBefore: u128,
  liquidityAfter: u128,
})
