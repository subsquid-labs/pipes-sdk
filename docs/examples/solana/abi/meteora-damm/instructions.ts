import { address, bool, option, struct, u64, unit } from '@subsquid/borsh'
import { instruction } from '../abi.support.js'
import { ConfigParameters, CurveType, CustomizableParams, PoolFees } from './types.js'

/**
 * Initialize a new permissioned pool.
 */
export interface InitializePermissionedPool {
  curveType: CurveType
}

/**
 * Initialize a new permissioned pool.
 */
export const initializePermissionedPool = instruction(
  {
    d8: '0x4d55b29d3230d47e',
  },
  {
    /**
     * Pool account (arbitrary address)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * Token A mint of the pool. Eg: USDT
     */
    tokenAMint: 2,
    /**
     * Token B mint of the pool. Eg: USDC
     */
    tokenBMint: 3,
    /**
     * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 4,
    /**
     * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 5,
    /**
     * LP token mint of vault A
     */
    aVaultLpMint: 6,
    /**
     * LP token mint of vault B
     */
    bVaultLpMint: 7,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 8,
    /**
     * LP token account of vault B. Used to receive/burn vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 9,
    /**
     * Admin token account for pool token A mint. Used to bootstrap the pool with initial liquidity.
     */
    adminTokenA: 10,
    /**
     * Admin token account for pool token B mint. Used to bootstrap the pool with initial liquidity.
     */
    adminTokenB: 11,
    /**
     * Admin pool LP token account. Used to receive LP during first deposit (initialize pool)
     * Admin pool LP token account. Used to receive LP during first deposit (initialize pool)
     */
    adminPoolLp: 12,
    /**
     * Protocol fee token account for token A. Used to receive trading fee.
     */
    protocolTokenAFee: 13,
    /**
     * Protocol fee token account for token B. Used to receive trading fee.
     */
    protocolTokenBFee: 14,
    /**
     * Admin account. This account will be the admin of the pool, and the payer for PDA during initialize pool.
     */
    admin: 15,
    feeOwner: 16,
    /**
     * Rent account.
     */
    rent: 17,
    mintMetadata: 18,
    metadataProgram: 19,
    /**
     * Vault program. The pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 20,
    /**
     * Token program.
     */
    tokenProgram: 21,
    /**
     * Associated token program.
     */
    associatedTokenProgram: 22,
    /**
     * System program.
     */
    systemProgram: 23,
  },
  struct({
    curveType: CurveType,
  }),
)

/**
 * Initialize a new permissionless pool.
 */
export interface InitializePermissionlessPool {
  curveType: CurveType
  tokenAAmount: bigint
  tokenBAmount: bigint
}

/**
 * Initialize a new permissionless pool.
 */
export const initializePermissionlessPool = instruction(
  {
    d8: '0x76ad299dad486167',
  },
  {
    /**
     * Pool account (PDA address)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * Token A mint of the pool. Eg: USDT
     */
    tokenAMint: 2,
    /**
     * Token B mint of the pool. Eg: USDC
     */
    tokenBMint: 3,
    /**
     * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 4,
    /**
     * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 5,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 6,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 7,
    /**
     * LP token mint of vault A
     */
    aVaultLpMint: 8,
    /**
     * LP token mint of vault B
     */
    bVaultLpMint: 9,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 10,
    /**
     * LP token account of vault B. Used to receive/burn vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 11,
    /**
     * Payer token account for pool token A mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenA: 12,
    /**
     * Admin token account for pool token B mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenB: 13,
    payerPoolLp: 14,
    /**
     * Protocol fee token account for token A. Used to receive trading fee.
     */
    protocolTokenAFee: 15,
    /**
     * Protocol fee token account for token B. Used to receive trading fee.
     */
    protocolTokenBFee: 16,
    /**
     * Admin account. This account will be the admin of the pool, and the payer for PDA during initialize pool.
     */
    payer: 17,
    feeOwner: 18,
    /**
     * Rent account.
     */
    rent: 19,
    mintMetadata: 20,
    metadataProgram: 21,
    /**
     * Vault program. The pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 22,
    /**
     * Token program.
     */
    tokenProgram: 23,
    /**
     * Associated token program.
     */
    associatedTokenProgram: 24,
    /**
     * System program.
     */
    systemProgram: 25,
  },
  struct({
    curveType: CurveType,
    tokenAAmount: u64,
    tokenBAmount: u64,
  }),
)

/**
 * Initialize a new permissionless pool with customized fee tier
 */
export interface InitializePermissionlessPoolWithFeeTier {
  curveType: CurveType
  tradeFeeBps: bigint
  tokenAAmount: bigint
  tokenBAmount: bigint
}

/**
 * Initialize a new permissionless pool with customized fee tier
 */
export const initializePermissionlessPoolWithFeeTier = instruction(
  {
    d8: '0x06874493e552a971',
  },
  {
    /**
     * Pool account (PDA address)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * Token A mint of the pool. Eg: USDT
     */
    tokenAMint: 2,
    /**
     * Token B mint of the pool. Eg: USDC
     */
    tokenBMint: 3,
    /**
     * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 4,
    /**
     * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 5,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 6,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 7,
    /**
     * LP token mint of vault A
     */
    aVaultLpMint: 8,
    /**
     * LP token mint of vault B
     */
    bVaultLpMint: 9,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 10,
    /**
     * LP token account of vault B. Used to receive/burn vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 11,
    /**
     * Payer token account for pool token A mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenA: 12,
    /**
     * Admin token account for pool token B mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenB: 13,
    payerPoolLp: 14,
    /**
     * Protocol fee token account for token A. Used to receive trading fee.
     */
    protocolTokenAFee: 15,
    /**
     * Protocol fee token account for token B. Used to receive trading fee.
     */
    protocolTokenBFee: 16,
    /**
     * Admin account. This account will be the admin of the pool, and the payer for PDA during initialize pool.
     */
    payer: 17,
    feeOwner: 18,
    /**
     * Rent account.
     */
    rent: 19,
    mintMetadata: 20,
    metadataProgram: 21,
    /**
     * Vault program. The pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 22,
    /**
     * Token program.
     */
    tokenProgram: 23,
    /**
     * Associated token program.
     */
    associatedTokenProgram: 24,
    /**
     * System program.
     */
    systemProgram: 25,
  },
  struct({
    curveType: CurveType,
    tradeFeeBps: u64,
    tokenAAmount: u64,
    tokenBAmount: u64,
  }),
)

/**
 * Enable or disable a pool. A disabled pool allow only remove balanced liquidity operation.
 */
export interface EnableOrDisablePool {
  enable: boolean
}

/**
 * Enable or disable a pool. A disabled pool allow only remove balanced liquidity operation.
 */
export const enableOrDisablePool = instruction(
  {
    d8: '0x8006e48337a134a9',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * Admin account. Must be owner of the pool.
     */
    admin: 1,
  },
  struct({
    enable: bool,
  }),
)

/**
 * Swap token A to B, or vice versa. An amount of trading fee will be charged for liquidity provider, and the admin of the pool.
 */
export interface Swap {
  inAmount: bigint
  minimumOutAmount: bigint
}

/**
 * Swap token A to B, or vice versa. An amount of trading fee will be charged for liquidity provider, and the admin of the pool.
 */
export const swap = instruction(
  {
    d8: '0xf8c69e91e17587c8',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * User token account. Token from this account will be transfer into the vault by the pool in exchange for another token of the pool.
     */
    userSourceToken: 1,
    /**
     * User token account. The exchanged token will be transfer into this account from the pool.
     */
    userDestinationToken: 2,
    /**
     * Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 3,
    /**
     * Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 4,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 5,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 6,
    /**
     * Lp token mint of vault a
     */
    aVaultLpMint: 7,
    /**
     * Lp token mint of vault b
     */
    bVaultLpMint: 8,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 9,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 10,
    /**
     * Protocol fee token account. Used to receive trading fee. It's mint field must matched with user_source_token mint field.
     */
    protocolTokenFee: 11,
    /**
     * User account. Must be owner of user_source_token.
     */
    user: 12,
    /**
     * Vault program. the pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 13,
    /**
     * Token program.
     */
    tokenProgram: 14,
  },
  struct({
    inAmount: u64,
    minimumOutAmount: u64,
  }),
)

/**
 * Withdraw only single token from the pool. Only supported by pool with stable swap curve.
 */
export interface RemoveLiquiditySingleSide {
  poolTokenAmount: bigint
  minimumOutAmount: bigint
}

/**
 * Withdraw only single token from the pool. Only supported by pool with stable swap curve.
 */
export const removeLiquiditySingleSide = instruction(
  {
    d8: '0x5454b142feb90afb',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * User pool lp token account. LP will be burned from this account upon success liquidity removal.
     */
    userPoolLp: 2,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 3,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 4,
    /**
     * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 5,
    /**
     * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 6,
    /**
     * LP token mint of vault A
     */
    aVaultLpMint: 7,
    /**
     * LP token mint of vault B
     */
    bVaultLpMint: 8,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 9,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 10,
    /**
     * User token account to receive token upon success liquidity removal.
     */
    userDestinationToken: 11,
    /**
     * User account. Must be owner of the user_pool_lp account.
     */
    user: 12,
    /**
     * Vault program. The pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 13,
    /**
     * Token program.
     */
    tokenProgram: 14,
  },
  struct({
    poolTokenAmount: u64,
    minimumOutAmount: u64,
  }),
)

/**
 * Deposit tokens to the pool in an imbalance ratio. Only supported by pool with stable swap curve.
 */
export interface AddImbalanceLiquidity {
  minimumPoolTokenAmount: bigint
  tokenAAmount: bigint
  tokenBAmount: bigint
}

/**
 * Deposit tokens to the pool in an imbalance ratio. Only supported by pool with stable swap curve.
 */
export const addImbalanceLiquidity = instruction(
  {
    d8: '0x4f237a54ad0f5dbf',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * user pool lp token account. lp will be burned from this account upon success liquidity removal.
     */
    userPoolLp: 2,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 3,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 4,
    /**
     * Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 5,
    /**
     * Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 6,
    /**
     * LP token mint of vault a
     */
    aVaultLpMint: 7,
    /**
     * LP token mint of vault b
     */
    bVaultLpMint: 8,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 9,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 10,
    /**
     * User token A account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userAToken: 11,
    /**
     * User token B account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userBToken: 12,
    /**
     * User account. Must be owner of user_a_token, and user_b_token.
     */
    user: 13,
    /**
     * Vault program. the pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 14,
    /**
     * Token program.
     */
    tokenProgram: 15,
  },
  struct({
    minimumPoolTokenAmount: u64,
    tokenAAmount: u64,
    tokenBAmount: u64,
  }),
)

/**
 * Withdraw tokens from the pool in a balanced ratio. User will still able to withdraw from pool even the pool is disabled. This allow user to exit their liquidity when there's some unforeseen event happen.
 */
export interface RemoveBalanceLiquidity {
  poolTokenAmount: bigint
  minimumATokenOut: bigint
  minimumBTokenOut: bigint
}

/**
 * Withdraw tokens from the pool in a balanced ratio. User will still able to withdraw from pool even the pool is disabled. This allow user to exit their liquidity when there's some unforeseen event happen.
 */
export const removeBalanceLiquidity = instruction(
  {
    d8: '0x856d2cb338ee7221',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * user pool lp token account. lp will be burned from this account upon success liquidity removal.
     */
    userPoolLp: 2,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 3,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 4,
    /**
     * Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 5,
    /**
     * Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 6,
    /**
     * LP token mint of vault a
     */
    aVaultLpMint: 7,
    /**
     * LP token mint of vault b
     */
    bVaultLpMint: 8,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 9,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 10,
    /**
     * User token A account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userAToken: 11,
    /**
     * User token B account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userBToken: 12,
    /**
     * User account. Must be owner of user_a_token, and user_b_token.
     */
    user: 13,
    /**
     * Vault program. the pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 14,
    /**
     * Token program.
     */
    tokenProgram: 15,
  },
  struct({
    poolTokenAmount: u64,
    minimumATokenOut: u64,
    minimumBTokenOut: u64,
  }),
)

/**
 * Deposit tokens to the pool in a balanced ratio.
 */
export interface AddBalanceLiquidity {
  poolTokenAmount: bigint
  maximumTokenAAmount: bigint
  maximumTokenBAmount: bigint
}

/**
 * Deposit tokens to the pool in a balanced ratio.
 */
export const addBalanceLiquidity = instruction(
  {
    d8: '0xa8e3323ebdab54b0',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * user pool lp token account. lp will be burned from this account upon success liquidity removal.
     */
    userPoolLp: 2,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 3,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 4,
    /**
     * Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 5,
    /**
     * Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 6,
    /**
     * LP token mint of vault a
     */
    aVaultLpMint: 7,
    /**
     * LP token mint of vault b
     */
    bVaultLpMint: 8,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 9,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 10,
    /**
     * User token A account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userAToken: 11,
    /**
     * User token B account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userBToken: 12,
    /**
     * User account. Must be owner of user_a_token, and user_b_token.
     */
    user: 13,
    /**
     * Vault program. the pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 14,
    /**
     * Token program.
     */
    tokenProgram: 15,
  },
  struct({
    poolTokenAmount: u64,
    maximumTokenAAmount: u64,
    maximumTokenBAmount: u64,
  }),
)

/**
 * Update trading fee charged for liquidity provider, and admin.
 */
export interface SetPoolFees {
  fees: PoolFees
  newPartnerFeeNumerator: bigint
}

/**
 * Update trading fee charged for liquidity provider, and admin.
 */
export const setPoolFees = instruction(
  {
    d8: '0x662c9e36cd257e4e',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * Fee operator account
     */
    feeOperator: 1,
  },
  struct({
    fees: PoolFees,
    newPartnerFeeNumerator: u64,
  }),
)

/**
 * Update swap curve parameters. This function do not allow update of curve type. For example: stable swap curve to constant product curve. Only supported by pool with stable swap curve.
 * Only amp is allowed to be override. The other attributes of stable swap curve will be ignored.
 */
export interface OverrideCurveParam {
  curveType: CurveType
}

/**
 * Update swap curve parameters. This function do not allow update of curve type. For example: stable swap curve to constant product curve. Only supported by pool with stable swap curve.
 * Only amp is allowed to be override. The other attributes of stable swap curve will be ignored.
 */
export const overrideCurveParam = instruction(
  {
    d8: '0x6256cc335e4745bb',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * Admin account.
     */
    admin: 1,
  },
  struct({
    curveType: CurveType,
  }),
)

/**
 * Get the general information of the pool.
 */
export type GetPoolInfo = undefined

/**
 * Get the general information of the pool.
 */
export const getPoolInfo = instruction(
  {
    d8: '0x0930dc6516f04ec8',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 2,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 3,
    /**
     * Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 4,
    /**
     * Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 5,
    /**
     * LP token mint of vault a
     */
    aVaultLpMint: 6,
    /**
     * LP token mint of vault b
     */
    bVaultLpMint: 7,
  },
  unit,
)

/**
 * Bootstrap the pool when liquidity is depleted.
 */
export interface BootstrapLiquidity {
  tokenAAmount: bigint
  tokenBAmount: bigint
}

/**
 * Bootstrap the pool when liquidity is depleted.
 */
export const bootstrapLiquidity = instruction(
  {
    d8: '0x04e4d747e1fd77ce',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * user pool lp token account. lp will be burned from this account upon success liquidity removal.
     */
    userPoolLp: 2,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 3,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 4,
    /**
     * Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 5,
    /**
     * Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 6,
    /**
     * LP token mint of vault a
     */
    aVaultLpMint: 7,
    /**
     * LP token mint of vault b
     */
    bVaultLpMint: 8,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 9,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 10,
    /**
     * User token A account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userAToken: 11,
    /**
     * User token B account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userBToken: 12,
    /**
     * User account. Must be owner of user_a_token, and user_b_token.
     */
    user: 13,
    /**
     * Vault program. the pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 14,
    /**
     * Token program.
     */
    tokenProgram: 15,
  },
  struct({
    tokenAAmount: u64,
    tokenBAmount: u64,
  }),
)

/**
 * Create mint metadata account for old pools
 */
export type CreateMintMetadata = undefined

/**
 * Create mint metadata account for old pools
 */
export const createMintMetadata = instruction(
  {
    d8: '0x0d46a829fa64945a',
  },
  {
    /**
     * Pool account
     */
    pool: 0,
    /**
     * LP mint account of the pool
     */
    lpMint: 1,
    /**
     * Vault A LP account of the pool
     */
    aVaultLp: 2,
    mintMetadata: 3,
    metadataProgram: 4,
    /**
     * System program.
     */
    systemProgram: 5,
    /**
     * Payer
     */
    payer: 6,
  },
  unit,
)

/**
 * Create lock account
 */
export type CreateLockEscrow = undefined

/**
 * Create lock account
 */
export const createLockEscrow = instruction(
  {
    d8: '0x3657a51345e3dae0',
  },
  {
    /**
     * Pool account
     */
    pool: 0,
    /**
     * Lock account
     */
    lockEscrow: 1,
    owner: 2,
    /**
     * LP token mint of the pool
     */
    lpMint: 3,
    /**
     * Payer account
     */
    payer: 4,
    /**
     * System program.
     */
    systemProgram: 5,
  },
  unit,
)

/**
 * Lock Lp token
 */
export interface Lock {
  maxAmount: bigint
}

/**
 * Lock Lp token
 */
export const lock = instruction(
  {
    d8: '0x1513d02bed3eff57',
  },
  {
    /**
     * Pool account
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * Lock account
     */
    lockEscrow: 2,
    /**
     * Can be anyone
     */
    owner: 3,
    /**
     * owner lp token account
     */
    sourceTokens: 4,
    /**
     * Escrow vault
     */
    escrowVault: 5,
    /**
     * Token program.
     */
    tokenProgram: 6,
    /**
     * Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 7,
    /**
     * Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 8,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 9,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 10,
    /**
     * LP token mint of vault a
     */
    aVaultLpMint: 11,
    /**
     * LP token mint of vault b
     */
    bVaultLpMint: 12,
  },
  struct({
    maxAmount: u64,
  }),
)

/**
 * Claim fee
 */
export interface ClaimFee {
  maxAmount: bigint
}

/**
 * Claim fee
 */
export const claimFee = instruction(
  {
    d8: '0xa9204f8988e84689',
  },
  {
    /**
     * Pool account
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * Lock account
     */
    lockEscrow: 2,
    /**
     * Owner of lock account
     */
    owner: 3,
    /**
     * owner lp token account
     */
    sourceTokens: 4,
    /**
     * Escrow vault
     */
    escrowVault: 5,
    /**
     * Token program.
     */
    tokenProgram: 6,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 7,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 8,
    /**
     * Vault account for token a. token a of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 9,
    /**
     * Vault account for token b. token b of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 10,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 11,
    /**
     * LP token account of vault B. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 12,
    /**
     * LP token mint of vault a
     */
    aVaultLpMint: 13,
    /**
     * LP token mint of vault b
     */
    bVaultLpMint: 14,
    /**
     * User token A account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userAToken: 15,
    /**
     * User token B account. Token will be transfer from this account if it is add liquidity operation. Else, token will be transfer into this account.
     */
    userBToken: 16,
    /**
     * Vault program. the pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 17,
  },
  struct({
    maxAmount: u64,
  }),
)

/**
 * Create config
 */
export interface CreateConfig {
  configParameters: ConfigParameters
}

/**
 * Create config
 */
export const createConfig = instruction(
  {
    d8: '0xc9cff3724b6f2fbd',
  },
  {
    config: 0,
    admin: 1,
    systemProgram: 2,
  },
  struct({
    configParameters: ConfigParameters,
  }),
)

/**
 * Close config
 */
export type CloseConfig = undefined

/**
 * Close config
 */
export const closeConfig = instruction(
  {
    d8: '0x9109489d5f7d3d55',
  },
  {
    config: 0,
    admin: 1,
    rentReceiver: 2,
  },
  unit,
)

/**
 * Initialize permissionless pool with config
 */
export interface InitializePermissionlessConstantProductPoolWithConfig {
  tokenAAmount: bigint
  tokenBAmount: bigint
}

/**
 * Initialize permissionless pool with config
 */
export const initializePermissionlessConstantProductPoolWithConfig = instruction(
  {
    d8: '0x07a68aabceabecf4',
  },
  {
    /**
     * Pool account (PDA address)
     */
    pool: 0,
    config: 1,
    /**
     * LP token mint of the pool
     */
    lpMint: 2,
    /**
     * Token A mint of the pool. Eg: USDT
     */
    tokenAMint: 3,
    /**
     * Token B mint of the pool. Eg: USDC
     */
    tokenBMint: 4,
    /**
     * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 5,
    /**
     * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 6,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 7,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 8,
    /**
     * LP token mint of vault A
     */
    aVaultLpMint: 9,
    /**
     * LP token mint of vault B
     */
    bVaultLpMint: 10,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 11,
    /**
     * LP token account of vault B. Used to receive/burn vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 12,
    /**
     * Payer token account for pool token A mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenA: 13,
    /**
     * Admin token account for pool token B mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenB: 14,
    payerPoolLp: 15,
    /**
     * Protocol fee token account for token A. Used to receive trading fee.
     */
    protocolTokenAFee: 16,
    /**
     * Protocol fee token account for token B. Used to receive trading fee.
     */
    protocolTokenBFee: 17,
    /**
     * Admin account. This account will be the admin of the pool, and the payer for PDA during initialize pool.
     */
    payer: 18,
    /**
     * Rent account.
     */
    rent: 19,
    mintMetadata: 20,
    metadataProgram: 21,
    /**
     * Vault program. The pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 22,
    /**
     * Token program.
     */
    tokenProgram: 23,
    /**
     * Associated token program.
     */
    associatedTokenProgram: 24,
    /**
     * System program.
     */
    systemProgram: 25,
  },
  struct({
    tokenAAmount: u64,
    tokenBAmount: u64,
  }),
)

/**
 * Initialize permissionless pool with config 2
 */
export interface InitializePermissionlessConstantProductPoolWithConfig2 {
  tokenAAmount: bigint
  tokenBAmount: bigint
  activationPoint?: bigint | undefined
}

/**
 * Initialize permissionless pool with config 2
 */
export const initializePermissionlessConstantProductPoolWithConfig2 = instruction(
  {
    d8: '0x3095dc823d0b09b2',
  },
  {
    /**
     * Pool account (PDA address)
     */
    pool: 0,
    config: 1,
    /**
     * LP token mint of the pool
     */
    lpMint: 2,
    /**
     * Token A mint of the pool. Eg: USDT
     */
    tokenAMint: 3,
    /**
     * Token B mint of the pool. Eg: USDC
     */
    tokenBMint: 4,
    /**
     * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 5,
    /**
     * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 6,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 7,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 8,
    /**
     * LP token mint of vault A
     */
    aVaultLpMint: 9,
    /**
     * LP token mint of vault B
     */
    bVaultLpMint: 10,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 11,
    /**
     * LP token account of vault B. Used to receive/burn vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 12,
    /**
     * Payer token account for pool token A mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenA: 13,
    /**
     * Admin token account for pool token B mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenB: 14,
    payerPoolLp: 15,
    /**
     * Protocol fee token account for token A. Used to receive trading fee.
     */
    protocolTokenAFee: 16,
    /**
     * Protocol fee token account for token B. Used to receive trading fee.
     */
    protocolTokenBFee: 17,
    /**
     * Admin account. This account will be the admin of the pool, and the payer for PDA during initialize pool.
     */
    payer: 18,
    /**
     * Rent account.
     */
    rent: 19,
    mintMetadata: 20,
    metadataProgram: 21,
    /**
     * Vault program. The pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 22,
    /**
     * Token program.
     */
    tokenProgram: 23,
    /**
     * Associated token program.
     */
    associatedTokenProgram: 24,
    /**
     * System program.
     */
    systemProgram: 25,
  },
  struct({
    tokenAAmount: u64,
    tokenBAmount: u64,
    activationPoint: option(u64),
  }),
)

/**
 * Initialize permissionless pool with customizable params
 */
export interface InitializeCustomizablePermissionlessConstantProductPool {
  tokenAAmount: bigint
  tokenBAmount: bigint
  params: CustomizableParams
}

/**
 * Initialize permissionless pool with customizable params
 */
export const initializeCustomizablePermissionlessConstantProductPool = instruction(
  {
    d8: '0x9118acc2db7d03be',
  },
  {
    /**
     * Pool account (PDA address)
     */
    pool: 0,
    /**
     * LP token mint of the pool
     */
    lpMint: 1,
    /**
     * Token A mint of the pool. Eg: USDT
     */
    tokenAMint: 2,
    /**
     * Token B mint of the pool. Eg: USDC
     */
    tokenBMint: 3,
    /**
     * Vault account for token A. Token A of the pool will be deposit / withdraw from this vault account.
     */
    aVault: 4,
    /**
     * Vault account for token B. Token B of the pool will be deposit / withdraw from this vault account.
     */
    bVault: 5,
    /**
     * Token vault account of vault A
     */
    aTokenVault: 6,
    /**
     * Token vault account of vault B
     */
    bTokenVault: 7,
    /**
     * LP token mint of vault A
     */
    aVaultLpMint: 8,
    /**
     * LP token mint of vault B
     */
    bVaultLpMint: 9,
    /**
     * LP token account of vault A. Used to receive/burn the vault LP upon deposit/withdraw from the vault.
     */
    aVaultLp: 10,
    /**
     * LP token account of vault B. Used to receive/burn vault LP upon deposit/withdraw from the vault.
     */
    bVaultLp: 11,
    /**
     * Payer token account for pool token A mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenA: 12,
    /**
     * Admin token account for pool token B mint. Used to bootstrap the pool with initial liquidity.
     */
    payerTokenB: 13,
    payerPoolLp: 14,
    /**
     * Protocol fee token account for token A. Used to receive trading fee.
     */
    protocolTokenAFee: 15,
    /**
     * Protocol fee token account for token B. Used to receive trading fee.
     */
    protocolTokenBFee: 16,
    /**
     * Admin account. This account will be the admin of the pool, and the payer for PDA during initialize pool.
     */
    payer: 17,
    /**
     * Rent account.
     */
    rent: 18,
    mintMetadata: 19,
    metadataProgram: 20,
    /**
     * Vault program. The pool will deposit/withdraw liquidity from the vault.
     */
    vaultProgram: 21,
    /**
     * Token program.
     */
    tokenProgram: 22,
    /**
     * Associated token program.
     */
    associatedTokenProgram: 23,
    /**
     * System program.
     */
    systemProgram: 24,
  },
  struct({
    tokenAAmount: u64,
    tokenBAmount: u64,
    params: CustomizableParams,
  }),
)

/**
 * Update activation slot
 */
export interface UpdateActivationPoint {
  newActivationPoint: bigint
}

/**
 * Update activation slot
 */
export const updateActivationPoint = instruction(
  {
    d8: '0x963e7ddbabdc1aed',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    /**
     * Admin account.
     */
    admin: 1,
  },
  struct({
    newActivationPoint: u64,
  }),
)

/**
 * Withdraw protocol fee
 */
export type WithdrawProtocolFees = undefined

/**
 * Withdraw protocol fee
 */
export const withdrawProtocolFees = instruction(
  {
    d8: '0x0b44a56212d08649',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    aVaultLp: 1,
    protocolTokenAFee: 2,
    protocolTokenBFee: 3,
    treasuryTokenA: 4,
    treasuryTokenB: 5,
    tokenProgram: 6,
  },
  unit,
)

/**
 * Set whitelisted vault
 */
export interface SetWhitelistedVault {
  whitelistedVault: string
}

/**
 * Set whitelisted vault
 */
export const setWhitelistedVault = instruction(
  {
    d8: '0x0c945e2a373953f7',
  },
  {
    pool: 0,
    admin: 1,
  },
  struct({
    whitelistedVault: address,
  }),
)

/**
 * Partner claim fee
 */
export interface PartnerClaimFee {
  maxAmountA: bigint
  maxAmountB: bigint
}

/**
 * Partner claim fee
 */
export const partnerClaimFee = instruction(
  {
    d8: '0x3935b01e7b463440',
  },
  {
    /**
     * Pool account (PDA)
     */
    pool: 0,
    aVaultLp: 1,
    protocolTokenAFee: 2,
    protocolTokenBFee: 3,
    partnerTokenA: 4,
    partnerTokenB: 5,
    tokenProgram: 6,
    partnerAuthority: 7,
  },
  struct({
    maxAmountA: u64,
    maxAmountB: u64,
  }),
)
