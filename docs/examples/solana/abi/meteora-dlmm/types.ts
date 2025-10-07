import {
  address,
  array,
  bool,
  Codec,
  fixedArray,
  i16,
  i32,
  i64,
  i128,
  option,
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

export interface InitPresetParametersIx {
  /**
   * Bin step. Represent the price increment / decrement.
   */
  binStep: number
  /**
   * Used for base fee calculation. base_fee_rate = base_factor * bin_step
   */
  baseFactor: number
  /**
   * Filter period determine high frequency trading time window.
   */
  filterPeriod: number
  /**
   * Decay period determine when the volatile fee start decay / decrease.
   */
  decayPeriod: number
  /**
   * Reduction factor controls the volatile fee rate decrement rate.
   */
  reductionFactor: number
  /**
   * Used to scale the variable fee component depending on the dynamic of the market
   */
  variableFeeControl: number
  /**
   * Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
   */
  maxVolatilityAccumulator: number
  /**
   * Min bin id supported by the pool based on the configured bin step.
   */
  minBinId: number
  /**
   * Max bin id supported by the pool based on the configured bin step.
   */
  maxBinId: number
  /**
   * Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
   */
  protocolShare: number
}

export const InitPresetParametersIx: Codec<InitPresetParametersIx> = struct({
  /**
   * Bin step. Represent the price increment / decrement.
   */
  binStep: u16,
  /**
   * Used for base fee calculation. base_fee_rate = base_factor * bin_step
   */
  baseFactor: u16,
  /**
   * Filter period determine high frequency trading time window.
   */
  filterPeriod: u16,
  /**
   * Decay period determine when the volatile fee start decay / decrease.
   */
  decayPeriod: u16,
  /**
   * Reduction factor controls the volatile fee rate decrement rate.
   */
  reductionFactor: u16,
  /**
   * Used to scale the variable fee component depending on the dynamic of the market
   */
  variableFeeControl: u32,
  /**
   * Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
   */
  maxVolatilityAccumulator: u32,
  /**
   * Min bin id supported by the pool based on the configured bin step.
   */
  minBinId: i32,
  /**
   * Max bin id supported by the pool based on the configured bin step.
   */
  maxBinId: i32,
  /**
   * Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
   */
  protocolShare: u16,
})

export interface FeeParameter {
  /**
   * Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
   */
  protocolShare: number
  /**
   * Base factor for base fee rate
   */
  baseFactor: number
}

export const FeeParameter: Codec<FeeParameter> = struct({
  /**
   * Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
   */
  protocolShare: u16,
  /**
   * Base factor for base fee rate
   */
  baseFactor: u16,
})

export interface LiquidityParameterByStrategyOneSide {
  /**
   * Amount of X token or Y token to deposit
   */
  amount: bigint
  /**
   * Active bin that integrator observe off-chain
   */
  activeId: number
  /**
   * max active bin slippage allowed
   */
  maxActiveBinSlippage: number
  /**
   * strategy parameters
   */
  strategyParameters: StrategyParameters
}

export const LiquidityParameterByStrategyOneSide: Codec<LiquidityParameterByStrategyOneSide> = struct({
  /**
   * Amount of X token or Y token to deposit
   */
  amount: u64,
  /**
   * Active bin that integrator observe off-chain
   */
  activeId: i32,
  /**
   * max active bin slippage allowed
   */
  maxActiveBinSlippage: i32,
  /**
   * strategy parameters
   */
  strategyParameters: ref(() => StrategyParameters),
})

export interface LiquidityParameterByStrategy {
  /**
   * Amount of X token to deposit
   */
  amountX: bigint
  /**
   * Amount of Y token to deposit
   */
  amountY: bigint
  /**
   * Active bin that integrator observe off-chain
   */
  activeId: number
  /**
   * max active bin slippage allowed
   */
  maxActiveBinSlippage: number
  /**
   * strategy parameters
   */
  strategyParameters: StrategyParameters
}

export const LiquidityParameterByStrategy: Codec<LiquidityParameterByStrategy> = struct({
  /**
   * Amount of X token to deposit
   */
  amountX: u64,
  /**
   * Amount of Y token to deposit
   */
  amountY: u64,
  /**
   * Active bin that integrator observe off-chain
   */
  activeId: i32,
  /**
   * max active bin slippage allowed
   */
  maxActiveBinSlippage: i32,
  /**
   * strategy parameters
   */
  strategyParameters: ref(() => StrategyParameters),
})

export interface StrategyParameters {
  /**
   * min bin id
   */
  minBinId: number
  /**
   * max bin id
   */
  maxBinId: number
  /**
   * strategy type
   */
  strategyType: StrategyType
  /**
   * parameters
   */
  parameteres: Array<number>
}

export const StrategyParameters: Codec<StrategyParameters> = struct({
  /**
   * min bin id
   */
  minBinId: i32,
  /**
   * max bin id
   */
  maxBinId: i32,
  /**
   * strategy type
   */
  strategyType: ref(() => StrategyType),
  /**
   * parameters
   */
  parameteres: fixedArray(u8, 64),
})

export interface LiquidityOneSideParameter {
  /**
   * Amount of X token or Y token to deposit
   */
  amount: bigint
  /**
   * Active bin that integrator observe off-chain
   */
  activeId: number
  /**
   * max active bin slippage allowed
   */
  maxActiveBinSlippage: number
  /**
   * Liquidity distribution to each bins
   */
  binLiquidityDist: Array<BinLiquidityDistributionByWeight>
}

export const LiquidityOneSideParameter: Codec<LiquidityOneSideParameter> = struct({
  /**
   * Amount of X token or Y token to deposit
   */
  amount: u64,
  /**
   * Active bin that integrator observe off-chain
   */
  activeId: i32,
  /**
   * max active bin slippage allowed
   */
  maxActiveBinSlippage: i32,
  /**
   * Liquidity distribution to each bins
   */
  binLiquidityDist: array(ref(() => BinLiquidityDistributionByWeight)),
})

export interface BinLiquidityDistributionByWeight {
  /**
   * Define the bin ID wish to deposit to.
   */
  binId: number
  /**
   * weight of liquidity distributed for this bin id
   */
  weight: number
}

export const BinLiquidityDistributionByWeight: Codec<BinLiquidityDistributionByWeight> = struct({
  /**
   * Define the bin ID wish to deposit to.
   */
  binId: i32,
  /**
   * weight of liquidity distributed for this bin id
   */
  weight: u16,
})

export interface LiquidityParameterByWeight {
  /**
   * Amount of X token to deposit
   */
  amountX: bigint
  /**
   * Amount of Y token to deposit
   */
  amountY: bigint
  /**
   * Active bin that integrator observe off-chain
   */
  activeId: number
  /**
   * max active bin slippage allowed
   */
  maxActiveBinSlippage: number
  /**
   * Liquidity distribution to each bins
   */
  binLiquidityDist: Array<BinLiquidityDistributionByWeight>
}

export const LiquidityParameterByWeight: Codec<LiquidityParameterByWeight> = struct({
  /**
   * Amount of X token to deposit
   */
  amountX: u64,
  /**
   * Amount of Y token to deposit
   */
  amountY: u64,
  /**
   * Active bin that integrator observe off-chain
   */
  activeId: i32,
  /**
   * max active bin slippage allowed
   */
  maxActiveBinSlippage: i32,
  /**
   * Liquidity distribution to each bins
   */
  binLiquidityDist: array(ref(() => BinLiquidityDistributionByWeight)),
})

export interface AddLiquiditySingleSidePreciseParameter {
  bins: Array<CompressedBinDepositAmount>
  decompressMultiplier: bigint
}

export const AddLiquiditySingleSidePreciseParameter: Codec<AddLiquiditySingleSidePreciseParameter> = struct({
  bins: array(ref(() => CompressedBinDepositAmount)),
  decompressMultiplier: u64,
})

export interface CompressedBinDepositAmount {
  binId: number
  amount: number
}

export const CompressedBinDepositAmount: Codec<CompressedBinDepositAmount> = struct({
  binId: i32,
  amount: u32,
})

export interface BinLiquidityDistribution {
  /**
   * Define the bin ID wish to deposit to.
   */
  binId: number
  /**
   * DistributionX (or distributionY) is the percentages of amountX (or amountY) you want to add to each bin.
   */
  distributionX: number
  /**
   * DistributionX (or distributionY) is the percentages of amountX (or amountY) you want to add to each bin.
   */
  distributionY: number
}

export const BinLiquidityDistribution: Codec<BinLiquidityDistribution> = struct({
  /**
   * Define the bin ID wish to deposit to.
   */
  binId: i32,
  /**
   * DistributionX (or distributionY) is the percentages of amountX (or amountY) you want to add to each bin.
   */
  distributionX: u16,
  /**
   * DistributionX (or distributionY) is the percentages of amountX (or amountY) you want to add to each bin.
   */
  distributionY: u16,
})

export interface LiquidityParameter {
  /**
   * Amount of X token to deposit
   */
  amountX: bigint
  /**
   * Amount of Y token to deposit
   */
  amountY: bigint
  /**
   * Liquidity distribution to each bins
   */
  binLiquidityDist: Array<BinLiquidityDistribution>
}

export const LiquidityParameter: Codec<LiquidityParameter> = struct({
  /**
   * Amount of X token to deposit
   */
  amountX: u64,
  /**
   * Amount of Y token to deposit
   */
  amountY: u64,
  /**
   * Liquidity distribution to each bins
   */
  binLiquidityDist: array(ref(() => BinLiquidityDistribution)),
})

export interface CustomizableParams {
  /**
   * Pool price
   */
  activeId: number
  /**
   * Bin step
   */
  binStep: number
  /**
   * Base factor
   */
  baseFactor: number
  /**
   * Activation type. 0 = Slot, 1 = Time. Check ActivationType enum
   */
  activationType: number
  /**
   * Whether the pool has an alpha vault
   */
  hasAlphaVault: boolean
  /**
   * Decide when does the pool start trade. None = Now
   */
  activationPoint?: bigint | undefined
  /**
   * Padding, for future use
   */
  padding: Array<number>
}

export const CustomizableParams: Codec<CustomizableParams> = struct({
  /**
   * Pool price
   */
  activeId: i32,
  /**
   * Bin step
   */
  binStep: u16,
  /**
   * Base factor
   */
  baseFactor: u16,
  /**
   * Activation type. 0 = Slot, 1 = Time. Check ActivationType enum
   */
  activationType: u8,
  /**
   * Whether the pool has an alpha vault
   */
  hasAlphaVault: bool,
  /**
   * Decide when does the pool start trade. None = Now
   */
  activationPoint: option(u64),
  /**
   * Padding, for future use
   */
  padding: fixedArray(u8, 64),
})

export interface InitPermissionPairIx {
  activeId: number
  binStep: number
  baseFactor: number
  minBinId: number
  maxBinId: number
  activationType: number
}

export const InitPermissionPairIx: Codec<InitPermissionPairIx> = struct({
  activeId: i32,
  binStep: u16,
  baseFactor: u16,
  minBinId: i32,
  maxBinId: i32,
  activationType: u8,
})

export interface BinLiquidityReduction {
  binId: number
  bpsToRemove: number
}

export const BinLiquidityReduction: Codec<BinLiquidityReduction> = struct({
  binId: i32,
  bpsToRemove: u16,
})

export interface Bin {
  /**
   * Amount of token X in the bin. This already excluded protocol fees.
   */
  amountX: bigint
  /**
   * Amount of token Y in the bin. This already excluded protocol fees.
   */
  amountY: bigint
  /**
   * Bin price
   */
  price: bigint
  /**
   * Liquidities of the bin. This is the same as LP mint supply. q-number
   */
  liquiditySupply: bigint
  /**
   * reward_a_per_token_stored
   */
  rewardPerTokenStored: Array<bigint>
  /**
   * Swap fee amount of token X per liquidity deposited.
   */
  feeAmountXPerTokenStored: bigint
  /**
   * Swap fee amount of token Y per liquidity deposited.
   */
  feeAmountYPerTokenStored: bigint
  /**
   * Total token X swap into the bin. Only used for tracking purpose.
   */
  amountXIn: bigint
  /**
   * Total token Y swap into he bin. Only used for tracking purpose.
   */
  amountYIn: bigint
}

export const Bin: Codec<Bin> = struct({
  /**
   * Amount of token X in the bin. This already excluded protocol fees.
   */
  amountX: u64,
  /**
   * Amount of token Y in the bin. This already excluded protocol fees.
   */
  amountY: u64,
  /**
   * Bin price
   */
  price: u128,
  /**
   * Liquidities of the bin. This is the same as LP mint supply. q-number
   */
  liquiditySupply: u128,
  /**
   * reward_a_per_token_stored
   */
  rewardPerTokenStored: fixedArray(u128, 2),
  /**
   * Swap fee amount of token X per liquidity deposited.
   */
  feeAmountXPerTokenStored: u128,
  /**
   * Swap fee amount of token Y per liquidity deposited.
   */
  feeAmountYPerTokenStored: u128,
  /**
   * Total token X swap into the bin. Only used for tracking purpose.
   */
  amountXIn: u128,
  /**
   * Total token Y swap into he bin. Only used for tracking purpose.
   */
  amountYIn: u128,
})

export interface ProtocolFee {
  amountX: bigint
  amountY: bigint
}

export const ProtocolFee: Codec<ProtocolFee> = struct({
  amountX: u64,
  amountY: u64,
})

export interface RewardInfo {
  /**
   * Reward token mint.
   */
  mint: string
  /**
   * Reward vault token account.
   */
  vault: string
  /**
   * Authority account that allows to fund rewards
   */
  funder: string
  /**
   * TODO check whether we need to store it in pool
   */
  rewardDuration: bigint
  /**
   * TODO check whether we need to store it in pool
   */
  rewardDurationEnd: bigint
  /**
   * TODO check whether we need to store it in pool
   */
  rewardRate: bigint
  /**
   * The last time reward states were updated.
   */
  lastUpdateTime: bigint
  /**
   * Accumulated seconds where when farm distribute rewards, but the bin is empty. The reward will be accumulated for next reward time window.
   */
  cumulativeSecondsWithEmptyLiquidityReward: bigint
}

export const RewardInfo: Codec<RewardInfo> = struct({
  /**
   * Reward token mint.
   */
  mint: address,
  /**
   * Reward vault token account.
   */
  vault: address,
  /**
   * Authority account that allows to fund rewards
   */
  funder: address,
  /**
   * TODO check whether we need to store it in pool
   */
  rewardDuration: u64,
  /**
   * TODO check whether we need to store it in pool
   */
  rewardDurationEnd: u64,
  /**
   * TODO check whether we need to store it in pool
   */
  rewardRate: u128,
  /**
   * The last time reward states were updated.
   */
  lastUpdateTime: u64,
  /**
   * Accumulated seconds where when farm distribute rewards, but the bin is empty. The reward will be accumulated for next reward time window.
   */
  cumulativeSecondsWithEmptyLiquidityReward: u64,
})

export interface Observation {
  /**
   * Cumulative active bin ID
   */
  cumulativeActiveBinId: bigint
  /**
   * Observation sample created timestamp
   */
  createdAt: bigint
  /**
   * Observation sample last updated timestamp
   */
  lastUpdatedAt: bigint
}

export const Observation: Codec<Observation> = struct({
  /**
   * Cumulative active bin ID
   */
  cumulativeActiveBinId: i128,
  /**
   * Observation sample created timestamp
   */
  createdAt: i64,
  /**
   * Observation sample last updated timestamp
   */
  lastUpdatedAt: i64,
})

export interface StaticParameters {
  /**
   * Used for base fee calculation. base_fee_rate = base_factor * bin_step
   */
  baseFactor: number
  /**
   * Filter period determine high frequency trading time window.
   */
  filterPeriod: number
  /**
   * Decay period determine when the volatile fee start decay / decrease.
   */
  decayPeriod: number
  /**
   * Reduction factor controls the volatile fee rate decrement rate.
   */
  reductionFactor: number
  /**
   * Used to scale the variable fee component depending on the dynamic of the market
   */
  variableFeeControl: number
  /**
   * Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
   */
  maxVolatilityAccumulator: number
  /**
   * Min bin id supported by the pool based on the configured bin step.
   */
  minBinId: number
  /**
   * Max bin id supported by the pool based on the configured bin step.
   */
  maxBinId: number
  /**
   * Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
   */
  protocolShare: number
  /**
   * Padding for bytemuck safe alignment
   */
  padding: Array<number>
}

export const StaticParameters: Codec<StaticParameters> = struct({
  /**
   * Used for base fee calculation. base_fee_rate = base_factor * bin_step
   */
  baseFactor: u16,
  /**
   * Filter period determine high frequency trading time window.
   */
  filterPeriod: u16,
  /**
   * Decay period determine when the volatile fee start decay / decrease.
   */
  decayPeriod: u16,
  /**
   * Reduction factor controls the volatile fee rate decrement rate.
   */
  reductionFactor: u16,
  /**
   * Used to scale the variable fee component depending on the dynamic of the market
   */
  variableFeeControl: u32,
  /**
   * Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
   */
  maxVolatilityAccumulator: u32,
  /**
   * Min bin id supported by the pool based on the configured bin step.
   */
  minBinId: i32,
  /**
   * Max bin id supported by the pool based on the configured bin step.
   */
  maxBinId: i32,
  /**
   * Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
   */
  protocolShare: u16,
  /**
   * Padding for bytemuck safe alignment
   */
  padding: fixedArray(u8, 6),
})

export interface VariableParameters {
  /**
   * Volatility accumulator measure the number of bin crossed since reference bin ID. Normally (without filter period taken into consideration), reference bin ID is the active bin of last swap.
   * It affects the variable fee rate
   */
  volatilityAccumulator: number
  /**
   * Volatility reference is decayed volatility accumulator. It is always <= volatility_accumulator
   */
  volatilityReference: number
  /**
   * Active bin id of last swap.
   */
  indexReference: number
  /**
   * Padding for bytemuck safe alignment
   */
  padding: Array<number>
  /**
   * Last timestamp the variable parameters was updated
   */
  lastUpdateTimestamp: bigint
  /**
   * Padding for bytemuck safe alignment
   */
  padding1: Array<number>
}

export const VariableParameters: Codec<VariableParameters> = struct({
  /**
   * Volatility accumulator measure the number of bin crossed since reference bin ID. Normally (without filter period taken into consideration), reference bin ID is the active bin of last swap.
   * It affects the variable fee rate
   */
  volatilityAccumulator: u32,
  /**
   * Volatility reference is decayed volatility accumulator. It is always <= volatility_accumulator
   */
  volatilityReference: u32,
  /**
   * Active bin id of last swap.
   */
  indexReference: i32,
  /**
   * Padding for bytemuck safe alignment
   */
  padding: fixedArray(u8, 4),
  /**
   * Last timestamp the variable parameters was updated
   */
  lastUpdateTimestamp: i64,
  /**
   * Padding for bytemuck safe alignment
   */
  padding1: fixedArray(u8, 8),
})

export interface FeeInfo {
  feeXPerTokenComplete: bigint
  feeYPerTokenComplete: bigint
  feeXPending: bigint
  feeYPending: bigint
}

export const FeeInfo: Codec<FeeInfo> = struct({
  feeXPerTokenComplete: u128,
  feeYPerTokenComplete: u128,
  feeXPending: u64,
  feeYPending: u64,
})

export interface UserRewardInfo {
  rewardPerTokenCompletes: Array<bigint>
  rewardPendings: Array<bigint>
}

export const UserRewardInfo: Codec<UserRewardInfo> = struct({
  rewardPerTokenCompletes: fixedArray(u128, 2),
  rewardPendings: fixedArray(u64, 2),
})

export type StrategyType_SpotOneSide = undefined

export const StrategyType_SpotOneSide = unit

export type StrategyType_CurveOneSide = undefined

export const StrategyType_CurveOneSide = unit

export type StrategyType_BidAskOneSide = undefined

export const StrategyType_BidAskOneSide = unit

export type StrategyType_SpotBalanced = undefined

export const StrategyType_SpotBalanced = unit

export type StrategyType_CurveBalanced = undefined

export const StrategyType_CurveBalanced = unit

export type StrategyType_BidAskBalanced = undefined

export const StrategyType_BidAskBalanced = unit

export type StrategyType_SpotImBalanced = undefined

export const StrategyType_SpotImBalanced = unit

export type StrategyType_CurveImBalanced = undefined

export const StrategyType_CurveImBalanced = unit

export type StrategyType_BidAskImBalanced = undefined

export const StrategyType_BidAskImBalanced = unit

export type StrategyType =
  | {
      kind: 'SpotOneSide'
      value?: StrategyType_SpotOneSide
    }
  | {
      kind: 'CurveOneSide'
      value?: StrategyType_CurveOneSide
    }
  | {
      kind: 'BidAskOneSide'
      value?: StrategyType_BidAskOneSide
    }
  | {
      kind: 'SpotBalanced'
      value?: StrategyType_SpotBalanced
    }
  | {
      kind: 'CurveBalanced'
      value?: StrategyType_CurveBalanced
    }
  | {
      kind: 'BidAskBalanced'
      value?: StrategyType_BidAskBalanced
    }
  | {
      kind: 'SpotImBalanced'
      value?: StrategyType_SpotImBalanced
    }
  | {
      kind: 'CurveImBalanced'
      value?: StrategyType_CurveImBalanced
    }
  | {
      kind: 'BidAskImBalanced'
      value?: StrategyType_BidAskImBalanced
    }

export const StrategyType: Codec<StrategyType> = sum(1, {
  SpotOneSide: {
    discriminator: 0,
    value: StrategyType_SpotOneSide,
  },
  CurveOneSide: {
    discriminator: 1,
    value: StrategyType_CurveOneSide,
  },
  BidAskOneSide: {
    discriminator: 2,
    value: StrategyType_BidAskOneSide,
  },
  SpotBalanced: {
    discriminator: 3,
    value: StrategyType_SpotBalanced,
  },
  CurveBalanced: {
    discriminator: 4,
    value: StrategyType_CurveBalanced,
  },
  BidAskBalanced: {
    discriminator: 5,
    value: StrategyType_BidAskBalanced,
  },
  SpotImBalanced: {
    discriminator: 6,
    value: StrategyType_SpotImBalanced,
  },
  CurveImBalanced: {
    discriminator: 7,
    value: StrategyType_CurveImBalanced,
  },
  BidAskImBalanced: {
    discriminator: 8,
    value: StrategyType_BidAskImBalanced,
  },
})

export type Rounding_Up = undefined

export const Rounding_Up = unit

export type Rounding_Down = undefined

export const Rounding_Down = unit

export type Rounding =
  | {
      kind: 'Up'
      value?: Rounding_Up
    }
  | {
      kind: 'Down'
      value?: Rounding_Down
    }

export const Rounding: Codec<Rounding> = sum(1, {
  Up: {
    discriminator: 0,
    value: Rounding_Up,
  },
  Down: {
    discriminator: 1,
    value: Rounding_Down,
  },
})

export type ActivationType_Slot = undefined

export const ActivationType_Slot = unit

export type ActivationType_Timestamp = undefined

export const ActivationType_Timestamp = unit

export type ActivationType =
  | {
      kind: 'Slot'
      value?: ActivationType_Slot
    }
  | {
      kind: 'Timestamp'
      value?: ActivationType_Timestamp
    }

export const ActivationType: Codec<ActivationType> = sum(1, {
  Slot: {
    discriminator: 0,
    value: ActivationType_Slot,
  },
  Timestamp: {
    discriminator: 1,
    value: ActivationType_Timestamp,
  },
})

export type LayoutVersion_V0 = undefined

export const LayoutVersion_V0 = unit

export type LayoutVersion_V1 = undefined

export const LayoutVersion_V1 = unit

export type LayoutVersion =
  | {
      kind: 'V0'
      value?: LayoutVersion_V0
    }
  | {
      kind: 'V1'
      value?: LayoutVersion_V1
    }

export const LayoutVersion: Codec<LayoutVersion> = sum(1, {
  V0: {
    discriminator: 0,
    value: LayoutVersion_V0,
  },
  V1: {
    discriminator: 1,
    value: LayoutVersion_V1,
  },
})

export type PairType_Permissionless = undefined

export const PairType_Permissionless = unit

export type PairType_Permission = undefined

export const PairType_Permission = unit

export type PairType_CustomizablePermissionless = undefined

export const PairType_CustomizablePermissionless = unit

export type PairType =
  | {
      kind: 'Permissionless'
      value?: PairType_Permissionless
    }
  | {
      kind: 'Permission'
      value?: PairType_Permission
    }
  | {
      kind: 'CustomizablePermissionless'
      value?: PairType_CustomizablePermissionless
    }

export const PairType: Codec<PairType> = sum(1, {
  Permissionless: {
    discriminator: 0,
    value: PairType_Permissionless,
  },
  Permission: {
    discriminator: 1,
    value: PairType_Permission,
  },
  CustomizablePermissionless: {
    discriminator: 2,
    value: PairType_CustomizablePermissionless,
  },
})

export type PairStatus_Enabled = undefined

export const PairStatus_Enabled = unit

export type PairStatus_Disabled = undefined

export const PairStatus_Disabled = unit

export type PairStatus =
  | {
      kind: 'Enabled'
      value?: PairStatus_Enabled
    }
  | {
      kind: 'Disabled'
      value?: PairStatus_Disabled
    }

export const PairStatus: Codec<PairStatus> = sum(1, {
  Enabled: {
    discriminator: 0,
    value: PairStatus_Enabled,
  },
  Disabled: {
    discriminator: 1,
    value: PairStatus_Disabled,
  },
})

export interface BinArrayBitmapExtension {
  lbPair: string
  /**
   * Packed initialized bin array state for start_bin_index is positive
   */
  positiveBinArrayBitmap: Array<Array<bigint>>
  /**
   * Packed initialized bin array state for start_bin_index is negative
   */
  negativeBinArrayBitmap: Array<Array<bigint>>
}

export const BinArrayBitmapExtension: Codec<BinArrayBitmapExtension> = struct({
  lbPair: address,
  /**
   * Packed initialized bin array state for start_bin_index is positive
   */
  positiveBinArrayBitmap: fixedArray(fixedArray(u64, 8), 12),
  /**
   * Packed initialized bin array state for start_bin_index is negative
   */
  negativeBinArrayBitmap: fixedArray(fixedArray(u64, 8), 12),
})

export interface BinArray {
  index: bigint
  /**
   * Version of binArray
   */
  version: number
  padding: Array<number>
  lbPair: string
  bins: Array<Bin>
}

export const BinArray: Codec<BinArray> = struct({
  index: i64,
  /**
   * Version of binArray
   */
  version: u8,
  padding: fixedArray(u8, 7),
  lbPair: address,
  bins: fixedArray(
    ref(() => Bin),
    70,
  ),
})

export interface LbPair {
  parameters: StaticParameters
  vParameters: VariableParameters
  bumpSeed: Array<number>
  /**
   * Bin step signer seed
   */
  binStepSeed: Array<number>
  /**
   * Type of the pair
   */
  pairType: number
  /**
   * Active bin id
   */
  activeId: number
  /**
   * Bin step. Represent the price increment / decrement.
   */
  binStep: number
  /**
   * Status of the pair. Check PairStatus enum.
   */
  status: number
  /**
   * Require base factor seed
   */
  requireBaseFactorSeed: number
  /**
   * Base factor seed
   */
  baseFactorSeed: Array<number>
  /**
   * Activation type
   */
  activationType: number
  /**
   * padding 0
   */
  padding0: number
  /**
   * Token X mint
   */
  tokenXMint: string
  /**
   * Token Y mint
   */
  tokenYMint: string
  /**
   * LB token X vault
   */
  reserveX: string
  /**
   * LB token Y vault
   */
  reserveY: string
  /**
   * Uncollected protocol fee
   */
  protocolFee: ProtocolFee
  /**
   * _padding_1, previous Fee owner, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding1: Array<number>
  /**
   * Farming reward information
   */
  rewardInfos: Array<RewardInfo>
  /**
   * Oracle pubkey
   */
  oracle: string
  /**
   * Packed initialized bin array state
   */
  binArrayBitmap: Array<bigint>
  /**
   * Last time the pool fee parameter was updated
   */
  lastUpdatedAt: bigint
  /**
   * _padding_2, previous whitelisted_wallet, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding2: Array<number>
  /**
   * Address allowed to swap when the current point is greater than or equal to the pre-activation point. The pre-activation point is calculated as `activation_point - pre_activation_duration`.
   */
  preActivationSwapAddress: string
  /**
   * Base keypair. Only required for permission pair
   */
  baseKey: string
  /**
   * Time point to enable the pair. Only applicable for permission pair.
   */
  activationPoint: bigint
  /**
   * Duration before activation activation_point. Used to calculate pre-activation time point for pre_activation_swap_address
   */
  preActivationDuration: bigint
  /**
   * _padding 3 is reclaimed free space from swap_cap_deactivate_point and swap_cap_amount before, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding3: Array<number>
  /**
   * _padding_4, previous lock_duration, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding4: bigint
  /**
   * Pool creator
   */
  creator: string
  /**
   * Reserved space for future use
   */
  reserved: Array<number>
}

export const LbPair: Codec<LbPair> = struct({
  parameters: ref(() => StaticParameters),
  vParameters: ref(() => VariableParameters),
  bumpSeed: fixedArray(u8, 1),
  /**
   * Bin step signer seed
   */
  binStepSeed: fixedArray(u8, 2),
  /**
   * Type of the pair
   */
  pairType: u8,
  /**
   * Active bin id
   */
  activeId: i32,
  /**
   * Bin step. Represent the price increment / decrement.
   */
  binStep: u16,
  /**
   * Status of the pair. Check PairStatus enum.
   */
  status: u8,
  /**
   * Require base factor seed
   */
  requireBaseFactorSeed: u8,
  /**
   * Base factor seed
   */
  baseFactorSeed: fixedArray(u8, 2),
  /**
   * Activation type
   */
  activationType: u8,
  /**
   * padding 0
   */
  padding0: u8,
  /**
   * Token X mint
   */
  tokenXMint: address,
  /**
   * Token Y mint
   */
  tokenYMint: address,
  /**
   * LB token X vault
   */
  reserveX: address,
  /**
   * LB token Y vault
   */
  reserveY: address,
  /**
   * Uncollected protocol fee
   */
  protocolFee: ref(() => ProtocolFee),
  /**
   * _padding_1, previous Fee owner, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding1: fixedArray(u8, 32),
  /**
   * Farming reward information
   */
  rewardInfos: fixedArray(
    ref(() => RewardInfo),
    2,
  ),
  /**
   * Oracle pubkey
   */
  oracle: address,
  /**
   * Packed initialized bin array state
   */
  binArrayBitmap: fixedArray(u64, 16),
  /**
   * Last time the pool fee parameter was updated
   */
  lastUpdatedAt: i64,
  /**
   * _padding_2, previous whitelisted_wallet, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding2: fixedArray(u8, 32),
  /**
   * Address allowed to swap when the current point is greater than or equal to the pre-activation point. The pre-activation point is calculated as `activation_point - pre_activation_duration`.
   */
  preActivationSwapAddress: address,
  /**
   * Base keypair. Only required for permission pair
   */
  baseKey: address,
  /**
   * Time point to enable the pair. Only applicable for permission pair.
   */
  activationPoint: u64,
  /**
   * Duration before activation activation_point. Used to calculate pre-activation time point for pre_activation_swap_address
   */
  preActivationDuration: u64,
  /**
   * _padding 3 is reclaimed free space from swap_cap_deactivate_point and swap_cap_amount before, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding3: fixedArray(u8, 8),
  /**
   * _padding_4, previous lock_duration, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding4: u64,
  /**
   * Pool creator
   */
  creator: address,
  /**
   * Reserved space for future use
   */
  reserved: fixedArray(u8, 24),
})

export interface Oracle {
  /**
   * Index of latest observation
   */
  idx: bigint
  /**
   * Size of active sample. Active sample is initialized observation.
   */
  activeSize: bigint
  /**
   * Number of observations
   */
  length: bigint
}

export const Oracle: Codec<Oracle> = struct({
  /**
   * Index of latest observation
   */
  idx: u64,
  /**
   * Size of active sample. Active sample is initialized observation.
   */
  activeSize: u64,
  /**
   * Number of observations
   */
  length: u64,
})

export interface Position {
  /**
   * The LB pair of this position
   */
  lbPair: string
  /**
   * Owner of the position. Client rely on this to to fetch their positions.
   */
  owner: string
  /**
   * Liquidity shares of this position in bins (lower_bin_id <-> upper_bin_id). This is the same as LP concept.
   */
  liquidityShares: Array<bigint>
  /**
   * Farming reward information
   */
  rewardInfos: Array<UserRewardInfo>
  /**
   * Swap fee to claim information
   */
  feeInfos: Array<FeeInfo>
  /**
   * Lower bin ID
   */
  lowerBinId: number
  /**
   * Upper bin ID
   */
  upperBinId: number
  /**
   * Last updated timestamp
   */
  lastUpdatedAt: bigint
  /**
   * Total claimed token fee X
   */
  totalClaimedFeeXAmount: bigint
  /**
   * Total claimed token fee Y
   */
  totalClaimedFeeYAmount: bigint
  /**
   * Total claimed rewards
   */
  totalClaimedRewards: Array<bigint>
  /**
   * Reserved space for future use
   */
  reserved: Array<number>
}

export const Position: Codec<Position> = struct({
  /**
   * The LB pair of this position
   */
  lbPair: address,
  /**
   * Owner of the position. Client rely on this to to fetch their positions.
   */
  owner: address,
  /**
   * Liquidity shares of this position in bins (lower_bin_id <-> upper_bin_id). This is the same as LP concept.
   */
  liquidityShares: fixedArray(u64, 70),
  /**
   * Farming reward information
   */
  rewardInfos: fixedArray(
    ref(() => UserRewardInfo),
    70,
  ),
  /**
   * Swap fee to claim information
   */
  feeInfos: fixedArray(
    ref(() => FeeInfo),
    70,
  ),
  /**
   * Lower bin ID
   */
  lowerBinId: i32,
  /**
   * Upper bin ID
   */
  upperBinId: i32,
  /**
   * Last updated timestamp
   */
  lastUpdatedAt: i64,
  /**
   * Total claimed token fee X
   */
  totalClaimedFeeXAmount: u64,
  /**
   * Total claimed token fee Y
   */
  totalClaimedFeeYAmount: u64,
  /**
   * Total claimed rewards
   */
  totalClaimedRewards: fixedArray(u64, 2),
  /**
   * Reserved space for future use
   */
  reserved: fixedArray(u8, 160),
})

export interface PositionV2 {
  /**
   * The LB pair of this position
   */
  lbPair: string
  /**
   * Owner of the position. Client rely on this to to fetch their positions.
   */
  owner: string
  /**
   * Liquidity shares of this position in bins (lower_bin_id <-> upper_bin_id). This is the same as LP concept.
   */
  liquidityShares: Array<bigint>
  /**
   * Farming reward information
   */
  rewardInfos: Array<UserRewardInfo>
  /**
   * Swap fee to claim information
   */
  feeInfos: Array<FeeInfo>
  /**
   * Lower bin ID
   */
  lowerBinId: number
  /**
   * Upper bin ID
   */
  upperBinId: number
  /**
   * Last updated timestamp
   */
  lastUpdatedAt: bigint
  /**
   * Total claimed token fee X
   */
  totalClaimedFeeXAmount: bigint
  /**
   * Total claimed token fee Y
   */
  totalClaimedFeeYAmount: bigint
  /**
   * Total claimed rewards
   */
  totalClaimedRewards: Array<bigint>
  /**
   * Operator of position
   */
  operator: string
  /**
   * Time point which the locked liquidity can be withdraw
   */
  lockReleasePoint: bigint
  /**
   * _padding_0, previous subjected_to_bootstrap_liquidity_locking, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding0: number
  /**
   * Address is able to claim fee in this position, only valid for bootstrap_liquidity_position
   */
  feeOwner: string
  /**
   * Reserved space for future use
   */
  reserved: Array<number>
}

export const PositionV2: Codec<PositionV2> = struct({
  /**
   * The LB pair of this position
   */
  lbPair: address,
  /**
   * Owner of the position. Client rely on this to to fetch their positions.
   */
  owner: address,
  /**
   * Liquidity shares of this position in bins (lower_bin_id <-> upper_bin_id). This is the same as LP concept.
   */
  liquidityShares: fixedArray(u128, 70),
  /**
   * Farming reward information
   */
  rewardInfos: fixedArray(
    ref(() => UserRewardInfo),
    70,
  ),
  /**
   * Swap fee to claim information
   */
  feeInfos: fixedArray(
    ref(() => FeeInfo),
    70,
  ),
  /**
   * Lower bin ID
   */
  lowerBinId: i32,
  /**
   * Upper bin ID
   */
  upperBinId: i32,
  /**
   * Last updated timestamp
   */
  lastUpdatedAt: i64,
  /**
   * Total claimed token fee X
   */
  totalClaimedFeeXAmount: u64,
  /**
   * Total claimed token fee Y
   */
  totalClaimedFeeYAmount: u64,
  /**
   * Total claimed rewards
   */
  totalClaimedRewards: fixedArray(u64, 2),
  /**
   * Operator of position
   */
  operator: address,
  /**
   * Time point which the locked liquidity can be withdraw
   */
  lockReleasePoint: u64,
  /**
   * _padding_0, previous subjected_to_bootstrap_liquidity_locking, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!
   */
  padding0: u8,
  /**
   * Address is able to claim fee in this position, only valid for bootstrap_liquidity_position
   */
  feeOwner: address,
  /**
   * Reserved space for future use
   */
  reserved: fixedArray(u8, 87),
})

export interface PresetParameter {
  /**
   * Bin step. Represent the price increment / decrement.
   */
  binStep: number
  /**
   * Used for base fee calculation. base_fee_rate = base_factor * bin_step
   */
  baseFactor: number
  /**
   * Filter period determine high frequency trading time window.
   */
  filterPeriod: number
  /**
   * Decay period determine when the volatile fee start decay / decrease.
   */
  decayPeriod: number
  /**
   * Reduction factor controls the volatile fee rate decrement rate.
   */
  reductionFactor: number
  /**
   * Used to scale the variable fee component depending on the dynamic of the market
   */
  variableFeeControl: number
  /**
   * Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
   */
  maxVolatilityAccumulator: number
  /**
   * Min bin id supported by the pool based on the configured bin step.
   */
  minBinId: number
  /**
   * Max bin id supported by the pool based on the configured bin step.
   */
  maxBinId: number
  /**
   * Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
   */
  protocolShare: number
}

export const PresetParameter: Codec<PresetParameter> = struct({
  /**
   * Bin step. Represent the price increment / decrement.
   */
  binStep: u16,
  /**
   * Used for base fee calculation. base_fee_rate = base_factor * bin_step
   */
  baseFactor: u16,
  /**
   * Filter period determine high frequency trading time window.
   */
  filterPeriod: u16,
  /**
   * Decay period determine when the volatile fee start decay / decrease.
   */
  decayPeriod: u16,
  /**
   * Reduction factor controls the volatile fee rate decrement rate.
   */
  reductionFactor: u16,
  /**
   * Used to scale the variable fee component depending on the dynamic of the market
   */
  variableFeeControl: u32,
  /**
   * Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
   */
  maxVolatilityAccumulator: u32,
  /**
   * Min bin id supported by the pool based on the configured bin step.
   */
  minBinId: i32,
  /**
   * Max bin id supported by the pool based on the configured bin step.
   */
  maxBinId: i32,
  /**
   * Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
   */
  protocolShare: u16,
})

export interface CompositionFee {
  from: string
  binId: number
  tokenXFeeAmount: bigint
  tokenYFeeAmount: bigint
  protocolTokenXFeeAmount: bigint
  protocolTokenYFeeAmount: bigint
}

export const CompositionFee: Codec<CompositionFee> = struct({
  from: address,
  binId: i16,
  tokenXFeeAmount: u64,
  tokenYFeeAmount: u64,
  protocolTokenXFeeAmount: u64,
  protocolTokenYFeeAmount: u64,
})

export interface AddLiquidity {
  lbPair: string
  from: string
  position: string
  amounts: Array<bigint>
  activeBinId: number
}

export const AddLiquidity: Codec<AddLiquidity> = struct({
  lbPair: address,
  from: address,
  position: address,
  amounts: fixedArray(u64, 2),
  activeBinId: i32,
})

export interface RemoveLiquidity {
  lbPair: string
  from: string
  position: string
  amounts: Array<bigint>
  activeBinId: number
}

export const RemoveLiquidity: Codec<RemoveLiquidity> = struct({
  lbPair: address,
  from: address,
  position: address,
  amounts: fixedArray(u64, 2),
  activeBinId: i32,
})

export interface Swap {
  lbPair: string
  from: string
  startBinId: number
  endBinId: number
  amountIn: bigint
  amountOut: bigint
  swapForY: boolean
  fee: bigint
  protocolFee: bigint
  feeBps: bigint
  hostFee: bigint
}

export const Swap: Codec<Swap> = struct({
  lbPair: address,
  from: address,
  startBinId: i32,
  endBinId: i32,
  amountIn: u64,
  amountOut: u64,
  swapForY: bool,
  fee: u64,
  protocolFee: u64,
  feeBps: u128,
  hostFee: u64,
})

export interface ClaimReward {
  lbPair: string
  position: string
  owner: string
  rewardIndex: bigint
  totalReward: bigint
}

export const ClaimReward: Codec<ClaimReward> = struct({
  lbPair: address,
  position: address,
  owner: address,
  rewardIndex: u64,
  totalReward: u64,
})

export interface FundReward {
  lbPair: string
  funder: string
  rewardIndex: bigint
  amount: bigint
}

export const FundReward: Codec<FundReward> = struct({
  lbPair: address,
  funder: address,
  rewardIndex: u64,
  amount: u64,
})

export interface InitializeReward {
  lbPair: string
  rewardMint: string
  funder: string
  rewardIndex: bigint
  rewardDuration: bigint
}

export const InitializeReward: Codec<InitializeReward> = struct({
  lbPair: address,
  rewardMint: address,
  funder: address,
  rewardIndex: u64,
  rewardDuration: u64,
})

export interface UpdateRewardDuration {
  lbPair: string
  rewardIndex: bigint
  oldRewardDuration: bigint
  newRewardDuration: bigint
}

export const UpdateRewardDuration: Codec<UpdateRewardDuration> = struct({
  lbPair: address,
  rewardIndex: u64,
  oldRewardDuration: u64,
  newRewardDuration: u64,
})

export interface UpdateRewardFunder {
  lbPair: string
  rewardIndex: bigint
  oldFunder: string
  newFunder: string
}

export const UpdateRewardFunder: Codec<UpdateRewardFunder> = struct({
  lbPair: address,
  rewardIndex: u64,
  oldFunder: address,
  newFunder: address,
})

export interface PositionClose {
  position: string
  owner: string
}

export const PositionClose: Codec<PositionClose> = struct({
  position: address,
  owner: address,
})

export interface ClaimFee {
  lbPair: string
  position: string
  owner: string
  feeX: bigint
  feeY: bigint
}

export const ClaimFee: Codec<ClaimFee> = struct({
  lbPair: address,
  position: address,
  owner: address,
  feeX: u64,
  feeY: u64,
})

export interface LbPairCreate {
  lbPair: string
  binStep: number
  tokenX: string
  tokenY: string
}

export const LbPairCreate: Codec<LbPairCreate> = struct({
  lbPair: address,
  binStep: u16,
  tokenX: address,
  tokenY: address,
})

export interface PositionCreate {
  lbPair: string
  position: string
  owner: string
}

export const PositionCreate: Codec<PositionCreate> = struct({
  lbPair: address,
  position: address,
  owner: address,
})

export interface FeeParameterUpdate {
  lbPair: string
  protocolShare: number
  baseFactor: number
}

export const FeeParameterUpdate: Codec<FeeParameterUpdate> = struct({
  lbPair: address,
  protocolShare: u16,
  baseFactor: u16,
})

export interface IncreaseObservation {
  oracle: string
  newObservationLength: bigint
}

export const IncreaseObservation: Codec<IncreaseObservation> = struct({
  oracle: address,
  newObservationLength: u64,
})

export interface WithdrawIneligibleReward {
  lbPair: string
  rewardMint: string
  amount: bigint
}

export const WithdrawIneligibleReward: Codec<WithdrawIneligibleReward> = struct({
  lbPair: address,
  rewardMint: address,
  amount: u64,
})

export interface UpdatePositionOperator {
  position: string
  oldOperator: string
  newOperator: string
}

export const UpdatePositionOperator: Codec<UpdatePositionOperator> = struct({
  position: address,
  oldOperator: address,
  newOperator: address,
})

export interface UpdatePositionLockReleasePoint {
  position: string
  currentPoint: bigint
  newLockReleasePoint: bigint
  oldLockReleasePoint: bigint
  sender: string
}

export const UpdatePositionLockReleasePoint: Codec<UpdatePositionLockReleasePoint> = struct({
  position: address,
  currentPoint: u64,
  newLockReleasePoint: u64,
  oldLockReleasePoint: u64,
  sender: address,
})

export interface GoToABin {
  lbPair: string
  fromBinId: number
  toBinId: number
}

export const GoToABin: Codec<GoToABin> = struct({
  lbPair: address,
  fromBinId: i32,
  toBinId: i32,
})
