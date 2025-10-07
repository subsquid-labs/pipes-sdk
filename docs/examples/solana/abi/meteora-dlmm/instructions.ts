import { address, array, bool, i32, i64, option, struct, u16, u64, unit } from '@subsquid/borsh'
import { instruction } from '../abi.support.js'
import {
  AddLiquiditySingleSidePreciseParameter,
  BinLiquidityReduction,
  CustomizableParams,
  FeeParameter,
  InitPermissionPairIx,
  InitPresetParametersIx,
  LiquidityOneSideParameter,
  LiquidityParameter,
  LiquidityParameterByStrategy,
  LiquidityParameterByStrategyOneSide,
  LiquidityParameterByWeight,
} from './types'

export interface InitializeLbPair {
  activeId: number
  binStep: number
}

export const initializeLbPair = instruction(
  {
    d8: '0x2d9aedd2dd0fa65c',
  },
  {
    lbPair: 0,
    binArrayBitmapExtension: 1,
    tokenMintX: 2,
    tokenMintY: 3,
    reserveX: 4,
    reserveY: 5,
    oracle: 6,
    presetParameter: 7,
    funder: 8,
    tokenProgram: 9,
    systemProgram: 10,
    rent: 11,
    eventAuthority: 12,
    program: 13,
  },
  struct({
    activeId: i32,
    binStep: u16,
  }),
)

export interface InitializePermissionLbPair {
  ixData: InitPermissionPairIx
}

export const initializePermissionLbPair = instruction(
  {
    d8: '0x6c66d555fb033515',
  },
  {
    base: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    tokenMintX: 3,
    tokenMintY: 4,
    reserveX: 5,
    reserveY: 6,
    oracle: 7,
    admin: 8,
    tokenProgram: 9,
    systemProgram: 10,
    rent: 11,
    eventAuthority: 12,
    program: 13,
  },
  struct({
    ixData: InitPermissionPairIx,
  }),
)

export interface InitializeCustomizablePermissionlessLbPair {
  params: CustomizableParams
}

export const initializeCustomizablePermissionlessLbPair = instruction(
  {
    d8: '0x2e2729876fb7c840',
  },
  {
    lbPair: 0,
    binArrayBitmapExtension: 1,
    tokenMintX: 2,
    tokenMintY: 3,
    reserveX: 4,
    reserveY: 5,
    oracle: 6,
    userTokenX: 7,
    funder: 8,
    tokenProgram: 9,
    systemProgram: 10,
    rent: 11,
    eventAuthority: 12,
    program: 13,
  },
  struct({
    params: CustomizableParams,
  }),
)

export type InitializeBinArrayBitmapExtension = undefined

export const initializeBinArrayBitmapExtension = instruction(
  {
    d8: '0x2f9de2b40cf02147',
  },
  {
    lbPair: 0,
    /**
     * Initialize an account to store if a bin array is initialized.
     */
    binArrayBitmapExtension: 1,
    funder: 2,
    systemProgram: 3,
    rent: 4,
  },
  unit,
)

export interface InitializeBinArray {
  index: bigint
}

export const initializeBinArray = instruction(
  {
    d8: '0x235613b94ed44bd3',
  },
  {
    lbPair: 0,
    binArray: 1,
    funder: 2,
    systemProgram: 3,
  },
  struct({
    index: i64,
  }),
)

export interface AddLiquidity {
  liquidityParameter: LiquidityParameter
}

export const addLiquidity = instruction(
  {
    d8: '0xb59d59438fb63448',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userTokenX: 3,
    userTokenY: 4,
    reserveX: 5,
    reserveY: 6,
    tokenXMint: 7,
    tokenYMint: 8,
    binArrayLower: 9,
    binArrayUpper: 10,
    sender: 11,
    tokenXProgram: 12,
    tokenYProgram: 13,
    eventAuthority: 14,
    program: 15,
  },
  struct({
    liquidityParameter: LiquidityParameter,
  }),
)

export interface AddLiquidityByWeight {
  liquidityParameter: LiquidityParameterByWeight
}

export const addLiquidityByWeight = instruction(
  {
    d8: '0x1c8cee63e7a21595',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userTokenX: 3,
    userTokenY: 4,
    reserveX: 5,
    reserveY: 6,
    tokenXMint: 7,
    tokenYMint: 8,
    binArrayLower: 9,
    binArrayUpper: 10,
    sender: 11,
    tokenXProgram: 12,
    tokenYProgram: 13,
    eventAuthority: 14,
    program: 15,
  },
  struct({
    liquidityParameter: LiquidityParameterByWeight,
  }),
)

export interface AddLiquidityByStrategy {
  liquidityParameter: LiquidityParameterByStrategy
}

export const addLiquidityByStrategy = instruction(
  {
    d8: '0x0703967f94283dc8',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userTokenX: 3,
    userTokenY: 4,
    reserveX: 5,
    reserveY: 6,
    tokenXMint: 7,
    tokenYMint: 8,
    binArrayLower: 9,
    binArrayUpper: 10,
    sender: 11,
    tokenXProgram: 12,
    tokenYProgram: 13,
    eventAuthority: 14,
    program: 15,
  },
  struct({
    liquidityParameter: LiquidityParameterByStrategy,
  }),
)

export interface AddLiquidityByStrategyOneSide {
  liquidityParameter: LiquidityParameterByStrategyOneSide
}

export const addLiquidityByStrategyOneSide = instruction(
  {
    d8: '0x2905eeaf64e106cd',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userToken: 3,
    reserve: 4,
    tokenMint: 5,
    binArrayLower: 6,
    binArrayUpper: 7,
    sender: 8,
    tokenProgram: 9,
    eventAuthority: 10,
    program: 11,
  },
  struct({
    liquidityParameter: LiquidityParameterByStrategyOneSide,
  }),
)

export interface AddLiquidityOneSide {
  liquidityParameter: LiquidityOneSideParameter
}

export const addLiquidityOneSide = instruction(
  {
    d8: '0x5e9b6797465fdca5',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userToken: 3,
    reserve: 4,
    tokenMint: 5,
    binArrayLower: 6,
    binArrayUpper: 7,
    sender: 8,
    tokenProgram: 9,
    eventAuthority: 10,
    program: 11,
  },
  struct({
    liquidityParameter: LiquidityOneSideParameter,
  }),
)

export interface RemoveLiquidity {
  binLiquidityRemoval: Array<BinLiquidityReduction>
}

export const removeLiquidity = instruction(
  {
    d8: '0x5055d14818ceb16c',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userTokenX: 3,
    userTokenY: 4,
    reserveX: 5,
    reserveY: 6,
    tokenXMint: 7,
    tokenYMint: 8,
    binArrayLower: 9,
    binArrayUpper: 10,
    sender: 11,
    tokenXProgram: 12,
    tokenYProgram: 13,
    eventAuthority: 14,
    program: 15,
  },
  struct({
    binLiquidityRemoval: array(BinLiquidityReduction),
  }),
)

export interface InitializePosition {
  lowerBinId: number
  width: number
}

export const initializePosition = instruction(
  {
    d8: '0xdbc0ea47bebf6650',
  },
  {
    payer: 0,
    position: 1,
    lbPair: 2,
    owner: 3,
    systemProgram: 4,
    rent: 5,
    eventAuthority: 6,
    program: 7,
  },
  struct({
    lowerBinId: i32,
    width: i32,
  }),
)

export interface InitializePositionPda {
  lowerBinId: number
  width: number
}

export const initializePositionPda = instruction(
  {
    d8: '0x2e527d92558de499',
  },
  {
    payer: 0,
    base: 1,
    position: 2,
    lbPair: 3,
    /**
     * owner
     */
    owner: 4,
    systemProgram: 5,
    rent: 6,
    eventAuthority: 7,
    program: 8,
  },
  struct({
    lowerBinId: i32,
    width: i32,
  }),
)

export interface InitializePositionByOperator {
  lowerBinId: number
  width: number
  feeOwner: string
  lockReleasePoint: bigint
}

export const initializePositionByOperator = instruction(
  {
    d8: '0xfbbdbef475fe2394',
  },
  {
    payer: 0,
    base: 1,
    position: 2,
    lbPair: 3,
    owner: 4,
    /**
     * operator
     */
    operator: 5,
    operatorTokenX: 6,
    ownerTokenX: 7,
    systemProgram: 8,
    eventAuthority: 9,
    program: 10,
  },
  struct({
    lowerBinId: i32,
    width: i32,
    feeOwner: address,
    lockReleasePoint: u64,
  }),
)

export interface UpdatePositionOperator {
  operator: string
}

export const updatePositionOperator = instruction(
  {
    d8: '0xcab8678fb4bf74d9',
  },
  {
    position: 0,
    owner: 1,
    eventAuthority: 2,
    program: 3,
  },
  struct({
    operator: address,
  }),
)

export interface Swap {
  amountIn: bigint
  minAmountOut: bigint
}

export const swap = instruction(
  {
    d8: '0xf8c69e91e17587c8',
  },
  {
    lbPair: 0,
    binArrayBitmapExtension: 1,
    reserveX: 2,
    reserveY: 3,
    userTokenIn: 4,
    userTokenOut: 5,
    tokenXMint: 6,
    tokenYMint: 7,
    oracle: 8,
    hostFeeIn: 9,
    user: 10,
    tokenXProgram: 11,
    tokenYProgram: 12,
    eventAuthority: 13,
    program: 14,
  },
  struct({
    amountIn: u64,
    minAmountOut: u64,
  }),
)

export interface SwapExactOut {
  maxInAmount: bigint
  outAmount: bigint
}

export const swapExactOut = instruction(
  {
    d8: '0xfa49652126cf4bb8',
  },
  {
    lbPair: 0,
    binArrayBitmapExtension: 1,
    reserveX: 2,
    reserveY: 3,
    userTokenIn: 4,
    userTokenOut: 5,
    tokenXMint: 6,
    tokenYMint: 7,
    oracle: 8,
    hostFeeIn: 9,
    user: 10,
    tokenXProgram: 11,
    tokenYProgram: 12,
    eventAuthority: 13,
    program: 14,
  },
  struct({
    maxInAmount: u64,
    outAmount: u64,
  }),
)

export interface SwapWithPriceImpact {
  amountIn: bigint
  activeId?: number | undefined
  maxPriceImpactBps: number
}

export const swapWithPriceImpact = instruction(
  {
    d8: '0x38ade6d0ade49ccd',
  },
  {
    lbPair: 0,
    binArrayBitmapExtension: 1,
    reserveX: 2,
    reserveY: 3,
    userTokenIn: 4,
    userTokenOut: 5,
    tokenXMint: 6,
    tokenYMint: 7,
    oracle: 8,
    hostFeeIn: 9,
    user: 10,
    tokenXProgram: 11,
    tokenYProgram: 12,
    eventAuthority: 13,
    program: 14,
  },
  struct({
    amountIn: u64,
    activeId: option(i32),
    maxPriceImpactBps: u16,
  }),
)

export interface WithdrawProtocolFee {
  amountX: bigint
  amountY: bigint
}

export const withdrawProtocolFee = instruction(
  {
    d8: '0x9ec99ebd215da267',
  },
  {
    lbPair: 0,
    reserveX: 1,
    reserveY: 2,
    tokenXMint: 3,
    tokenYMint: 4,
    receiverTokenX: 5,
    receiverTokenY: 6,
    tokenXProgram: 7,
    tokenYProgram: 8,
  },
  struct({
    amountX: u64,
    amountY: u64,
  }),
)

export interface InitializeReward {
  rewardIndex: bigint
  rewardDuration: bigint
  funder: string
}

export const initializeReward = instruction(
  {
    d8: '0x5f87c0c4f281e644',
  },
  {
    lbPair: 0,
    rewardVault: 1,
    rewardMint: 2,
    admin: 3,
    tokenProgram: 4,
    systemProgram: 5,
    rent: 6,
    eventAuthority: 7,
    program: 8,
  },
  struct({
    rewardIndex: u64,
    rewardDuration: u64,
    funder: address,
  }),
)

export interface FundReward {
  rewardIndex: bigint
  amount: bigint
  carryForward: boolean
}

export const fundReward = instruction(
  {
    d8: '0xbc32f9a55d97263f',
  },
  {
    lbPair: 0,
    rewardVault: 1,
    rewardMint: 2,
    funderTokenAccount: 3,
    funder: 4,
    binArray: 5,
    tokenProgram: 6,
    eventAuthority: 7,
    program: 8,
  },
  struct({
    rewardIndex: u64,
    amount: u64,
    carryForward: bool,
  }),
)

export interface UpdateRewardFunder {
  rewardIndex: bigint
  newFunder: string
}

export const updateRewardFunder = instruction(
  {
    d8: '0xd31c3020d7a02317',
  },
  {
    lbPair: 0,
    admin: 1,
    eventAuthority: 2,
    program: 3,
  },
  struct({
    rewardIndex: u64,
    newFunder: address,
  }),
)

export interface UpdateRewardDuration {
  rewardIndex: bigint
  newDuration: bigint
}

export const updateRewardDuration = instruction(
  {
    d8: '0x8aaec4a9d5ebfe6b',
  },
  {
    lbPair: 0,
    admin: 1,
    binArray: 2,
    eventAuthority: 3,
    program: 4,
  },
  struct({
    rewardIndex: u64,
    newDuration: u64,
  }),
)

export interface ClaimReward {
  rewardIndex: bigint
}

export const claimReward = instruction(
  {
    d8: '0x955fb5f25e5a9ea2',
  },
  {
    lbPair: 0,
    position: 1,
    binArrayLower: 2,
    binArrayUpper: 3,
    sender: 4,
    rewardVault: 5,
    rewardMint: 6,
    userTokenAccount: 7,
    tokenProgram: 8,
    eventAuthority: 9,
    program: 10,
  },
  struct({
    rewardIndex: u64,
  }),
)

export type ClaimFee = undefined

export const claimFee = instruction(
  {
    d8: '0xa9204f8988e84689',
  },
  {
    lbPair: 0,
    position: 1,
    binArrayLower: 2,
    binArrayUpper: 3,
    sender: 4,
    reserveX: 5,
    reserveY: 6,
    userTokenX: 7,
    userTokenY: 8,
    tokenXMint: 9,
    tokenYMint: 10,
    tokenProgram: 11,
    eventAuthority: 12,
    program: 13,
  },
  unit,
)

export type ClosePosition = undefined

export const closePosition = instruction(
  {
    d8: '0x7b86510031446262',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayLower: 2,
    binArrayUpper: 3,
    sender: 4,
    rentReceiver: 5,
    eventAuthority: 6,
    program: 7,
  },
  unit,
)

export interface UpdateFeeParameters {
  feeParameter: FeeParameter
}

export const updateFeeParameters = instruction(
  {
    d8: '0x8080d05bf6351fb0',
  },
  {
    lbPair: 0,
    admin: 1,
    eventAuthority: 2,
    program: 3,
  },
  struct({
    feeParameter: FeeParameter,
  }),
)

export interface IncreaseOracleLength {
  lengthToAdd: bigint
}

export const increaseOracleLength = instruction(
  {
    d8: '0xbe3d7d57674f9ead',
  },
  {
    oracle: 0,
    funder: 1,
    systemProgram: 2,
    eventAuthority: 3,
    program: 4,
  },
  struct({
    lengthToAdd: u64,
  }),
)

export interface InitializePresetParameter {
  ix: InitPresetParametersIx
}

export const initializePresetParameter = instruction(
  {
    d8: '0x42bc47d3626d0eba',
  },
  {
    presetParameter: 0,
    admin: 1,
    systemProgram: 2,
    rent: 3,
  },
  struct({
    ix: InitPresetParametersIx,
  }),
)

export type ClosePresetParameter = undefined

export const closePresetParameter = instruction(
  {
    d8: '0x04949164861ab53d',
  },
  {
    presetParameter: 0,
    admin: 1,
    rentReceiver: 2,
  },
  unit,
)

export type RemoveAllLiquidity = undefined

export const removeAllLiquidity = instruction(
  {
    d8: '0x0a333d2370691855',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userTokenX: 3,
    userTokenY: 4,
    reserveX: 5,
    reserveY: 6,
    tokenXMint: 7,
    tokenYMint: 8,
    binArrayLower: 9,
    binArrayUpper: 10,
    sender: 11,
    tokenXProgram: 12,
    tokenYProgram: 13,
    eventAuthority: 14,
    program: 15,
  },
  unit,
)

export type TogglePairStatus = undefined

export const togglePairStatus = instruction(
  {
    d8: '0x3d7334172e0d1f90',
  },
  {
    lbPair: 0,
    admin: 1,
  },
  unit,
)

export type MigratePosition = undefined

export const migratePosition = instruction(
  {
    d8: '0x0f843b32c706fb2e',
  },
  {
    positionV2: 0,
    positionV1: 1,
    lbPair: 2,
    binArrayLower: 3,
    binArrayUpper: 4,
    owner: 5,
    systemProgram: 6,
    rentReceiver: 7,
    eventAuthority: 8,
    program: 9,
  },
  unit,
)

export type MigrateBinArray = undefined

export const migrateBinArray = instruction(
  {
    d8: '0x11179fd365b829f1',
  },
  {
    lbPair: 0,
  },
  unit,
)

export type UpdateFeesAndRewards = undefined

export const updateFeesAndRewards = instruction(
  {
    d8: '0x9ae6fa0decd14bdf',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayLower: 2,
    binArrayUpper: 3,
    owner: 4,
  },
  unit,
)

export interface WithdrawIneligibleReward {
  rewardIndex: bigint
}

export const withdrawIneligibleReward = instruction(
  {
    d8: '0x94ce2ac3f7316708',
  },
  {
    lbPair: 0,
    rewardVault: 1,
    rewardMint: 2,
    funderTokenAccount: 3,
    funder: 4,
    binArray: 5,
    tokenProgram: 6,
    eventAuthority: 7,
    program: 8,
  },
  struct({
    rewardIndex: u64,
  }),
)

export interface SetActivationPoint {
  activationPoint: bigint
}

export const setActivationPoint = instruction(
  {
    d8: '0x5bf90fa51a81fe7d',
  },
  {
    lbPair: 0,
    admin: 1,
  },
  struct({
    activationPoint: u64,
  }),
)

export interface RemoveLiquidityByRange {
  fromBinId: number
  toBinId: number
  bpsToRemove: number
}

export const removeLiquidityByRange = instruction(
  {
    d8: '0x1a526698f04a691a',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userTokenX: 3,
    userTokenY: 4,
    reserveX: 5,
    reserveY: 6,
    tokenXMint: 7,
    tokenYMint: 8,
    binArrayLower: 9,
    binArrayUpper: 10,
    sender: 11,
    tokenXProgram: 12,
    tokenYProgram: 13,
    eventAuthority: 14,
    program: 15,
  },
  struct({
    fromBinId: i32,
    toBinId: i32,
    bpsToRemove: u16,
  }),
)

export interface AddLiquidityOneSidePrecise {
  parameter: AddLiquiditySingleSidePreciseParameter
}

export const addLiquidityOneSidePrecise = instruction(
  {
    d8: '0xa1c26754ab47fa9a',
  },
  {
    position: 0,
    lbPair: 1,
    binArrayBitmapExtension: 2,
    userToken: 3,
    reserve: 4,
    tokenMint: 5,
    binArrayLower: 6,
    binArrayUpper: 7,
    sender: 8,
    tokenProgram: 9,
    eventAuthority: 10,
    program: 11,
  },
  struct({
    parameter: AddLiquiditySingleSidePreciseParameter,
  }),
)

export interface GoToABin {
  binId: number
}

export const goToABin = instruction(
  {
    d8: '0x9248aee028fd54ae',
  },
  {
    lbPair: 0,
    binArrayBitmapExtension: 1,
    fromBinArray: 2,
    toBinArray: 3,
    eventAuthority: 4,
    program: 5,
  },
  struct({
    binId: i32,
  }),
)

export interface SetPreActivationDuration {
  preActivationDuration: bigint
}

export const setPreActivationDuration = instruction(
  {
    d8: '0xa53dc9f4829f1664',
  },
  {
    lbPair: 0,
    creator: 1,
  },
  struct({
    preActivationDuration: u64,
  }),
)

export interface SetPreActivationSwapAddress {
  preActivationSwapAddress: string
}

export const setPreActivationSwapAddress = instruction(
  {
    d8: '0x398b2f7bd850df0a',
  },
  {
    lbPair: 0,
    creator: 1,
  },
  struct({
    preActivationSwapAddress: address,
  }),
)
