import {
  address,
  bool,
  Codec,
  f64,
  fixedArray,
  option,
  ref,
  struct,
  sum,
  u8,
  u32,
  u64,
  u128,
  unit,
} from '@subsquid/borsh'

export interface TokenMultiplier {
  /**
   * Multiplier for token A of the pool.
   */
  tokenAMultiplier: bigint
  /**
   * Multiplier for token B of the pool.
   */
  tokenBMultiplier: bigint
  /**
   * Record the highest token decimal in the pool. For example, Token A is 6 decimal, token B is 9 decimal. This will save value of 9.
   */
  precisionFactor: number
}

export const TokenMultiplier: Codec<TokenMultiplier> = struct({
  /**
   * Multiplier for token A of the pool.
   */
  tokenAMultiplier: u64,
  /**
   * Multiplier for token B of the pool.
   */
  tokenBMultiplier: u64,
  /**
   * Record the highest token decimal in the pool. For example, Token A is 6 decimal, token B is 9 decimal. This will save value of 9.
   */
  precisionFactor: u8,
})

export interface PoolFees {
  /**
   * Trade fees are extra token amounts that are held inside the token
   * accounts during a trade, making the value of liquidity tokens rise.
   * Trade fee numerator
   */
  tradeFeeNumerator: bigint
  /**
   * Trade fee denominator
   */
  tradeFeeDenominator: bigint
  /**
   * Protocol trading fees are extra token amounts that are held inside the token
   * accounts during a trade, with the equivalent in pool tokens minted to
   * the protocol of the program.
   * Protocol trade fee numerator
   */
  protocolTradeFeeNumerator: bigint
  /**
   * Protocol trade fee denominator
   */
  protocolTradeFeeDenominator: bigint
}

export const PoolFees: Codec<PoolFees> = struct({
  /**
   * Trade fees are extra token amounts that are held inside the token
   * accounts during a trade, making the value of liquidity tokens rise.
   * Trade fee numerator
   */
  tradeFeeNumerator: u64,
  /**
   * Trade fee denominator
   */
  tradeFeeDenominator: u64,
  /**
   * Protocol trading fees are extra token amounts that are held inside the token
   * accounts during a trade, with the equivalent in pool tokens minted to
   * the protocol of the program.
   * Protocol trade fee numerator
   */
  protocolTradeFeeNumerator: u64,
  /**
   * Protocol trade fee denominator
   */
  protocolTradeFeeDenominator: u64,
})

export interface Depeg {
  /**
   * The virtual price of staking / interest bearing token
   */
  baseVirtualPrice: bigint
  /**
   * The last time base_virtual_price is updated
   */
  baseCacheUpdated: bigint
  /**
   * Type of the depeg pool
   */
  depegType: DepegType
}

export const Depeg: Codec<Depeg> = struct({
  /**
   * The virtual price of staking / interest bearing token
   */
  baseVirtualPrice: u64,
  /**
   * The last time base_virtual_price is updated
   */
  baseCacheUpdated: u64,
  /**
   * Type of the depeg pool
   */
  depegType: ref(() => DepegType),
})

export interface ConfigParameters {
  tradeFeeNumerator: bigint
  protocolTradeFeeNumerator: bigint
  activationDuration: bigint
  vaultConfigKey: string
  poolCreatorAuthority: string
  activationType: number
  index: bigint
  partnerFeeNumerator: bigint
}

export const ConfigParameters: Codec<ConfigParameters> = struct({
  tradeFeeNumerator: u64,
  protocolTradeFeeNumerator: u64,
  activationDuration: u64,
  vaultConfigKey: address,
  poolCreatorAuthority: address,
  activationType: u8,
  index: u64,
  partnerFeeNumerator: u64,
})

export interface CustomizableParams {
  /**
   * Trading fee.
   */
  tradeFeeNumerator: number
  /**
   * The pool start trading.
   */
  activationPoint?: bigint | undefined
  /**
   * Whether the pool support alpha vault
   */
  hasAlphaVault: boolean
  /**
   * Activation type
   */
  activationType: number
  /**
   * Padding
   */
  padding: Array<number>
}

export const CustomizableParams: Codec<CustomizableParams> = struct({
  /**
   * Trading fee.
   */
  tradeFeeNumerator: u32,
  /**
   * The pool start trading.
   */
  activationPoint: option(u64),
  /**
   * Whether the pool support alpha vault
   */
  hasAlphaVault: bool,
  /**
   * Activation type
   */
  activationType: u8,
  /**
   * Padding
   */
  padding: fixedArray(u8, 90),
})

export interface Padding {
  /**
   * Padding 0
   */
  padding0: Array<number>
  /**
   * Padding 1
   */
  padding1: Array<bigint>
  /**
   * Padding 2
   */
  padding2: Array<bigint>
}

export const Padding: Codec<Padding> = struct({
  /**
   * Padding 0
   */
  padding0: fixedArray(u8, 6),
  /**
   * Padding 1
   */
  padding1: fixedArray(u64, 21),
  /**
   * Padding 2
   */
  padding2: fixedArray(u64, 21),
})

export interface PartnerInfo {
  feeNumerator: bigint
  partnerAuthority: string
  pendingFeeA: bigint
  pendingFeeB: bigint
}

export const PartnerInfo: Codec<PartnerInfo> = struct({
  feeNumerator: u64,
  partnerAuthority: address,
  pendingFeeA: u64,
  pendingFeeB: u64,
})

export interface Bootstrapping {
  /**
   * Activation point, can be slot or timestamp
   */
  activationPoint: bigint
  /**
   * Whitelisted vault to be able to buy pool before activation_point
   */
  whitelistedVault: string
  /**
   * Need to store pool creator in lauch pool, so they can modify liquidity before activation_point
   */
  poolCreator: string
  /**
   * Activation type, 0 means by slot, 1 means by timestamp
   */
  activationType: number
}

export const Bootstrapping: Codec<Bootstrapping> = struct({
  /**
   * Activation point, can be slot or timestamp
   */
  activationPoint: u64,
  /**
   * Whitelisted vault to be able to buy pool before activation_point
   */
  whitelistedVault: address,
  /**
   * Need to store pool creator in lauch pool, so they can modify liquidity before activation_point
   */
  poolCreator: address,
  /**
   * Activation type, 0 means by slot, 1 means by timestamp
   */
  activationType: u8,
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

export type TradeDirection_AtoB = undefined

export const TradeDirection_AtoB = unit

export type TradeDirection_BtoA = undefined

export const TradeDirection_BtoA = unit

export type TradeDirection =
  | {
      kind: 'AtoB'
      value?: TradeDirection_AtoB
    }
  | {
      kind: 'BtoA'
      value?: TradeDirection_BtoA
    }

export const TradeDirection: Codec<TradeDirection> = sum(1, {
  AtoB: {
    discriminator: 0,
    value: TradeDirection_AtoB,
  },
  BtoA: {
    discriminator: 1,
    value: TradeDirection_BtoA,
  },
})

export type NewCurveType_ConstantProduct = undefined

export const NewCurveType_ConstantProduct = unit

export type NewCurveType_Stable = {
  /**
   * Amplification coefficient
   */
  amp: bigint
  /**
   * Multiplier for the pool token. Used to normalized token with different decimal into the same precision.
   */
  tokenMultiplier: TokenMultiplier
  /**
   * Depeg pool information. Contains functions to allow token amount to be repeg using stake / interest bearing token virtual price
   */
  depeg: Depeg
  /**
   * The last amp updated timestamp. Used to prevent update_curve_info called infinitely many times within a short period
   */
  lastAmpUpdatedTimestamp: bigint
}

export const NewCurveType_Stable = struct({
  /**
   * Amplification coefficient
   */
  amp: u64,
  /**
   * Multiplier for the pool token. Used to normalized token with different decimal into the same precision.
   */
  tokenMultiplier: ref(() => TokenMultiplier),
  /**
   * Depeg pool information. Contains functions to allow token amount to be repeg using stake / interest bearing token virtual price
   */
  depeg: ref(() => Depeg),
  /**
   * The last amp updated timestamp. Used to prevent update_curve_info called infinitely many times within a short period
   */
  lastAmpUpdatedTimestamp: u64,
})

export type NewCurveType_NewCurve = {
  fieldOne: bigint
  fieldTwo: bigint
}

export const NewCurveType_NewCurve = struct({
  fieldOne: u64,
  fieldTwo: u64,
})

export type NewCurveType =
  | {
      kind: 'ConstantProduct'
      value?: NewCurveType_ConstantProduct
    }
  | {
      kind: 'Stable'
      value: NewCurveType_Stable
    }
  | {
      kind: 'NewCurve'
      value: NewCurveType_NewCurve
    }

export const NewCurveType: Codec<NewCurveType> = sum(1, {
  ConstantProduct: {
    discriminator: 0,
    value: NewCurveType_ConstantProduct,
  },
  Stable: {
    discriminator: 1,
    value: NewCurveType_Stable,
  },
  NewCurve: {
    discriminator: 2,
    value: NewCurveType_NewCurve,
  },
})

export type CurveType_ConstantProduct = undefined

export const CurveType_ConstantProduct = unit

export type CurveType_Stable = {
  /**
   * Amplification coefficient
   */
  amp: bigint
  /**
   * Multiplier for the pool token. Used to normalized token with different decimal into the same precision.
   */
  tokenMultiplier: TokenMultiplier
  /**
   * Depeg pool information. Contains functions to allow token amount to be repeg using stake / interest bearing token virtual price
   */
  depeg: Depeg
  /**
   * The last amp updated timestamp. Used to prevent update_curve_info called infinitely many times within a short period
   */
  lastAmpUpdatedTimestamp: bigint
}

export const CurveType_Stable = struct({
  /**
   * Amplification coefficient
   */
  amp: u64,
  /**
   * Multiplier for the pool token. Used to normalized token with different decimal into the same precision.
   */
  tokenMultiplier: ref(() => TokenMultiplier),
  /**
   * Depeg pool information. Contains functions to allow token amount to be repeg using stake / interest bearing token virtual price
   */
  depeg: ref(() => Depeg),
  /**
   * The last amp updated timestamp. Used to prevent update_curve_info called infinitely many times within a short period
   */
  lastAmpUpdatedTimestamp: u64,
})

export type CurveType =
  | {
      kind: 'ConstantProduct'
      value?: CurveType_ConstantProduct
    }
  | {
      kind: 'Stable'
      value: CurveType_Stable
    }

export const CurveType: Codec<CurveType> = sum(1, {
  ConstantProduct: {
    discriminator: 0,
    value: CurveType_ConstantProduct,
  },
  Stable: {
    discriminator: 1,
    value: CurveType_Stable,
  },
})

export type DepegType_None = undefined

export const DepegType_None = unit

export type DepegType_Marinade = undefined

export const DepegType_Marinade = unit

export type DepegType_Lido = undefined

export const DepegType_Lido = unit

export type DepegType_SplStake = undefined

export const DepegType_SplStake = unit

export type DepegType =
  | {
      kind: 'None'
      value?: DepegType_None
    }
  | {
      kind: 'Marinade'
      value?: DepegType_Marinade
    }
  | {
      kind: 'Lido'
      value?: DepegType_Lido
    }
  | {
      kind: 'SplStake'
      value?: DepegType_SplStake
    }

export const DepegType: Codec<DepegType> = sum(1, {
  None: {
    discriminator: 0,
    value: DepegType_None,
  },
  Marinade: {
    discriminator: 1,
    value: DepegType_Marinade,
  },
  Lido: {
    discriminator: 2,
    value: DepegType_Lido,
  },
  SplStake: {
    discriminator: 3,
    value: DepegType_SplStake,
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

export type PoolType_Permissioned = undefined

export const PoolType_Permissioned = unit

export type PoolType_Permissionless = undefined

export const PoolType_Permissionless = unit

export type PoolType =
  | {
      kind: 'Permissioned'
      value?: PoolType_Permissioned
    }
  | {
      kind: 'Permissionless'
      value?: PoolType_Permissionless
    }

export const PoolType: Codec<PoolType> = sum(1, {
  Permissioned: {
    discriminator: 0,
    value: PoolType_Permissioned,
  },
  Permissionless: {
    discriminator: 1,
    value: PoolType_Permissionless,
  },
})

export interface Config {
  poolFees: PoolFees
  activationDuration: bigint
  vaultConfigKey: string
  /**
   * Only pool_creator_authority can use the current config to initialize new pool. When it's Pubkey::default, it's a public config.
   */
  poolCreatorAuthority: string
  /**
   * Activation type
   */
  activationType: number
  partnerFeeNumerator: bigint
  padding: Array<number>
}

export const Config: Codec<Config> = struct({
  poolFees: ref(() => PoolFees),
  activationDuration: u64,
  vaultConfigKey: address,
  /**
   * Only pool_creator_authority can use the current config to initialize new pool. When it's Pubkey::default, it's a public config.
   */
  poolCreatorAuthority: address,
  /**
   * Activation type
   */
  activationType: u8,
  partnerFeeNumerator: u64,
  padding: fixedArray(u8, 219),
})

export interface LockEscrow {
  /**
   * Pool address
   */
  pool: string
  /**
   * Owner address
   */
  owner: string
  /**
   * Vault address, store the lock user lock
   */
  escrowVault: string
  /**
   * bump, used to sign
   */
  bump: number
  /**
   * Total locked amount
   */
  totalLockedAmount: bigint
  /**
   * Lp per token, virtual price of lp token
   */
  lpPerToken: bigint
  /**
   * Unclaimed fee pending
   */
  unclaimedFeePending: bigint
  /**
   * Total a fee claimed so far
   */
  aFee: bigint
  /**
   * Total b fee claimed so far
   */
  bFee: bigint
}

export const LockEscrow: Codec<LockEscrow> = struct({
  /**
   * Pool address
   */
  pool: address,
  /**
   * Owner address
   */
  owner: address,
  /**
   * Vault address, store the lock user lock
   */
  escrowVault: address,
  /**
   * bump, used to sign
   */
  bump: u8,
  /**
   * Total locked amount
   */
  totalLockedAmount: u64,
  /**
   * Lp per token, virtual price of lp token
   */
  lpPerToken: u128,
  /**
   * Unclaimed fee pending
   */
  unclaimedFeePending: u64,
  /**
   * Total a fee claimed so far
   */
  aFee: u64,
  /**
   * Total b fee claimed so far
   */
  bFee: u64,
})

export interface Pool {
  /**
   * LP token mint of the pool
   */
  lpMint: string
  /**
   * Token A mint of the pool. Eg: USDT
   */
  tokenAMint: string
  /**
   * Token B mint of the pool. Eg: USDC
   */
  tokenBMint: string
  /**
   * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
   */
  aVault: string
  /**
   * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
   */
  bVault: string
  /**
   * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
   */
  aVaultLp: string
  /**
   * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
   */
  bVaultLp: string
  /**
   * "A" vault lp bump. Used to create signer seeds.
   */
  aVaultLpBump: number
  /**
   * Flag to determine whether the pool is enabled, or disabled.
   */
  enabled: boolean
  /**
   * Protocol fee token account for token A. Used to receive trading fee.
   */
  protocolTokenAFee: string
  /**
   * Protocol fee token account for token B. Used to receive trading fee.
   */
  protocolTokenBFee: string
  /**
   * Fee last updated timestamp
   */
  feeLastUpdatedAt: bigint
  padding0: Array<number>
  /**
   * Store the fee charges setting.
   */
  fees: PoolFees
  /**
   * Pool type
   */
  poolType: PoolType
  /**
   * Stake pubkey of SPL stake pool
   */
  stake: string
  /**
   * Total locked lp token
   */
  totalLockedLp: bigint
  /**
   * bootstrapping config
   */
  bootstrapping: Bootstrapping
  partnerInfo: PartnerInfo
  /**
   * Padding for future pool field
   */
  padding: Padding
  /**
   * The type of the swap curve supported by the pool.
   */
  curveType: CurveType
}

export const Pool: Codec<Pool> = struct({
  /**
   * LP token mint of the pool
   */
  lpMint: address,
  /**
   * Token A mint of the pool. Eg: USDT
   */
  tokenAMint: address,
  /**
   * Token B mint of the pool. Eg: USDC
   */
  tokenBMint: address,
  /**
   * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
   */
  aVault: address,
  /**
   * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
   */
  bVault: address,
  /**
   * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
   */
  aVaultLp: address,
  /**
   * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
   */
  bVaultLp: address,
  /**
   * "A" vault lp bump. Used to create signer seeds.
   */
  aVaultLpBump: u8,
  /**
   * Flag to determine whether the pool is enabled, or disabled.
   */
  enabled: bool,
  /**
   * Protocol fee token account for token A. Used to receive trading fee.
   */
  protocolTokenAFee: address,
  /**
   * Protocol fee token account for token B. Used to receive trading fee.
   */
  protocolTokenBFee: address,
  /**
   * Fee last updated timestamp
   */
  feeLastUpdatedAt: u64,
  padding0: fixedArray(u8, 24),
  /**
   * Store the fee charges setting.
   */
  fees: ref(() => PoolFees),
  /**
   * Pool type
   */
  poolType: ref(() => PoolType),
  /**
   * Stake pubkey of SPL stake pool
   */
  stake: address,
  /**
   * Total locked lp token
   */
  totalLockedLp: u64,
  /**
   * bootstrapping config
   */
  bootstrapping: ref(() => Bootstrapping),
  partnerInfo: ref(() => PartnerInfo),
  /**
   * Padding for future pool field
   */
  padding: ref(() => Padding),
  /**
   * The type of the swap curve supported by the pool.
   */
  curveType: ref(() => CurveType),
})

export interface AddLiquidity {
  lpMintAmount: bigint
  tokenAAmount: bigint
  tokenBAmount: bigint
}

export const AddLiquidity: Codec<AddLiquidity> = struct({
  lpMintAmount: u64,
  tokenAAmount: u64,
  tokenBAmount: u64,
})

export interface RemoveLiquidity {
  lpUnmintAmount: bigint
  tokenAOutAmount: bigint
  tokenBOutAmount: bigint
}

export const RemoveLiquidity: Codec<RemoveLiquidity> = struct({
  lpUnmintAmount: u64,
  tokenAOutAmount: u64,
  tokenBOutAmount: u64,
})

export interface BootstrapLiquidity {
  lpMintAmount: bigint
  tokenAAmount: bigint
  tokenBAmount: bigint
  pool: string
}

export const BootstrapLiquidity: Codec<BootstrapLiquidity> = struct({
  lpMintAmount: u64,
  tokenAAmount: u64,
  tokenBAmount: u64,
  pool: address,
})

export interface Swap {
  inAmount: bigint
  outAmount: bigint
  tradeFee: bigint
  protocolFee: bigint
  hostFee: bigint
}

export const Swap: Codec<Swap> = struct({
  inAmount: u64,
  outAmount: u64,
  tradeFee: u64,
  protocolFee: u64,
  hostFee: u64,
})

export interface SetPoolFees {
  tradeFeeNumerator: bigint
  tradeFeeDenominator: bigint
  protocolTradeFeeNumerator: bigint
  protocolTradeFeeDenominator: bigint
  pool: string
}

export const SetPoolFees: Codec<SetPoolFees> = struct({
  tradeFeeNumerator: u64,
  tradeFeeDenominator: u64,
  protocolTradeFeeNumerator: u64,
  protocolTradeFeeDenominator: u64,
  pool: address,
})

export interface PoolInfo {
  tokenAAmount: bigint
  tokenBAmount: bigint
  virtualPrice: number
  currentTimestamp: bigint
}

export const PoolInfo: Codec<PoolInfo> = struct({
  tokenAAmount: u64,
  tokenBAmount: u64,
  virtualPrice: f64,
  currentTimestamp: u64,
})

export interface TransferAdmin {
  admin: string
  newAdmin: string
  pool: string
}

export const TransferAdmin: Codec<TransferAdmin> = struct({
  admin: address,
  newAdmin: address,
  pool: address,
})

export interface OverrideCurveParam {
  newAmp: bigint
  updatedTimestamp: bigint
  pool: string
}

export const OverrideCurveParam: Codec<OverrideCurveParam> = struct({
  newAmp: u64,
  updatedTimestamp: u64,
  pool: address,
})

export interface PoolCreated {
  lpMint: string
  tokenAMint: string
  tokenBMint: string
  poolType: PoolType
  pool: string
}

export const PoolCreated: Codec<PoolCreated> = struct({
  lpMint: address,
  tokenAMint: address,
  tokenBMint: address,
  poolType: ref(() => PoolType),
  pool: address,
})

export interface PoolEnabled {
  pool: string
  enabled: boolean
}

export const PoolEnabled: Codec<PoolEnabled> = struct({
  pool: address,
  enabled: bool,
})

export interface MigrateFeeAccount {
  pool: string
  newAdminTokenAFee: string
  newAdminTokenBFee: string
  tokenAAmount: bigint
  tokenBAmount: bigint
}

export const MigrateFeeAccount: Codec<MigrateFeeAccount> = struct({
  pool: address,
  newAdminTokenAFee: address,
  newAdminTokenBFee: address,
  tokenAAmount: u64,
  tokenBAmount: u64,
})

export interface CreateLockEscrow {
  pool: string
  owner: string
}

export const CreateLockEscrow: Codec<CreateLockEscrow> = struct({
  pool: address,
  owner: address,
})

export interface Lock {
  pool: string
  owner: string
  amount: bigint
}

export const Lock: Codec<Lock> = struct({
  pool: address,
  owner: address,
  amount: u64,
})

export interface ClaimFee {
  pool: string
  owner: string
  amount: bigint
  aFee: bigint
  bFee: bigint
}

export const ClaimFee: Codec<ClaimFee> = struct({
  pool: address,
  owner: address,
  amount: u64,
  aFee: u64,
  bFee: u64,
})

export interface CreateConfig {
  tradeFeeNumerator: bigint
  protocolTradeFeeNumerator: bigint
  config: string
}

export const CreateConfig: Codec<CreateConfig> = struct({
  tradeFeeNumerator: u64,
  protocolTradeFeeNumerator: u64,
  config: address,
})

export interface CloseConfig {
  config: string
}

export const CloseConfig: Codec<CloseConfig> = struct({
  config: address,
})

export interface WithdrawProtocolFees {
  pool: string
  protocolAFee: bigint
  protocolBFee: bigint
  protocolAFeeOwner: string
  protocolBFeeOwner: string
}

export const WithdrawProtocolFees: Codec<WithdrawProtocolFees> = struct({
  pool: address,
  protocolAFee: u64,
  protocolBFee: u64,
  protocolAFeeOwner: address,
  protocolBFeeOwner: address,
})

export interface PartnerClaimFees {
  pool: string
  feeA: bigint
  feeB: bigint
  partner: string
}

export const PartnerClaimFees: Codec<PartnerClaimFees> = struct({
  pool: address,
  feeA: u64,
  feeB: u64,
  partner: address,
})
