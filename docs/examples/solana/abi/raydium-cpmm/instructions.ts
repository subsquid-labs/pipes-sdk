import { struct, u8, u16, u64 } from '@subsquid/borsh'
import { instruction } from '../abi.support.js'

/**
 * # Arguments
 *
 * * `ctx`- The accounts needed by instruction.
 * * `index` - The index of amm config, there may be multiple config.
 * * `trade_fee_rate` - Trade fee rate, can be changed.
 * * `protocol_fee_rate` - The rate of protocol fee within tarde fee.
 * * `fund_fee_rate` - The rate of fund fee within tarde fee.
 *
 */
export interface CreateAmmConfig {
  index: number
  tradeFeeRate: bigint
  protocolFeeRate: bigint
  fundFeeRate: bigint
  createPoolFee: bigint
}

/**
 * # Arguments
 *
 * * `ctx`- The accounts needed by instruction.
 * * `index` - The index of amm config, there may be multiple config.
 * * `trade_fee_rate` - Trade fee rate, can be changed.
 * * `protocol_fee_rate` - The rate of protocol fee within tarde fee.
 * * `fund_fee_rate` - The rate of fund fee within tarde fee.
 *
 */
export const createAmmConfig = instruction(
  {
    d8: '0x8934edd4d7756c68',
  },
  {
    /**
     * Address to be set as protocol owner.
     */
    owner: 0,
    /**
     * Initialize config state account to store protocol owner address and fee rates.
     */
    ammConfig: 1,
    systemProgram: 2,
  },
  struct({
    index: u16,
    tradeFeeRate: u64,
    protocolFeeRate: u64,
    fundFeeRate: u64,
    createPoolFee: u64,
  }),
)

/**
 * Updates the owner of the amm config
 * Must be called by the current owner or admin
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `trade_fee_rate`- The new trade fee rate of amm config, be set when `param` is 0
 * * `protocol_fee_rate`- The new protocol fee rate of amm config, be set when `param` is 1
 * * `fund_fee_rate`- The new fund fee rate of amm config, be set when `param` is 2
 * * `new_owner`- The config's new owner, be set when `param` is 3
 * * `new_fund_owner`- The config's new fund owner, be set when `param` is 4
 * * `param`- The vaule can be 0 | 1 | 2 | 3 | 4, otherwise will report a error
 *
 */
export interface UpdateAmmConfig {
  param: number
  value: bigint
}

/**
 * Updates the owner of the amm config
 * Must be called by the current owner or admin
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `trade_fee_rate`- The new trade fee rate of amm config, be set when `param` is 0
 * * `protocol_fee_rate`- The new protocol fee rate of amm config, be set when `param` is 1
 * * `fund_fee_rate`- The new fund fee rate of amm config, be set when `param` is 2
 * * `new_owner`- The config's new owner, be set when `param` is 3
 * * `new_fund_owner`- The config's new fund owner, be set when `param` is 4
 * * `param`- The vaule can be 0 | 1 | 2 | 3 | 4, otherwise will report a error
 *
 */
export const updateAmmConfig = instruction(
  {
    d8: '0x313cae889a1c74c8',
  },
  {
    /**
     * The amm config owner or admin
     */
    owner: 0,
    /**
     * Amm config account to be changed
     */
    ammConfig: 1,
  },
  struct({
    param: u8,
    value: u64,
  }),
)

/**
 * Update pool status for given vaule
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `status` - The vaule of status
 *
 */
export interface UpdatePoolStatus {
  status: number
}

/**
 * Update pool status for given vaule
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `status` - The vaule of status
 *
 */
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

/**
 * Collect the protocol fee accrued to the pool
 *
 * # Arguments
 *
 * * `ctx` - The context of accounts
 * * `amount_0_requested` - The maximum amount of token_0 to send, can be 0 to collect fees in only token_1
 * * `amount_1_requested` - The maximum amount of token_1 to send, can be 0 to collect fees in only token_0
 *
 */
export interface CollectProtocolFee {
  amount0Requested: bigint
  amount1Requested: bigint
}

/**
 * Collect the protocol fee accrued to the pool
 *
 * # Arguments
 *
 * * `ctx` - The context of accounts
 * * `amount_0_requested` - The maximum amount of token_0 to send, can be 0 to collect fees in only token_1
 * * `amount_1_requested` - The maximum amount of token_1 to send, can be 0 to collect fees in only token_0
 *
 */
export const collectProtocolFee = instruction(
  {
    d8: '0x8888fcddc2427e59',
  },
  {
    /**
     * Only admin or owner can collect fee now
     */
    owner: 0,
    authority: 1,
    /**
     * Pool state stores accumulated protocol fee amount
     */
    poolState: 2,
    /**
     * Amm config account stores owner
     */
    ammConfig: 3,
    /**
     * The address that holds pool tokens for token_0
     */
    token0Vault: 4,
    /**
     * The address that holds pool tokens for token_1
     */
    token1Vault: 5,
    /**
     * The mint of token_0 vault
     */
    vault0Mint: 6,
    /**
     * The mint of token_1 vault
     */
    vault1Mint: 7,
    /**
     * The address that receives the collected token_0 protocol fees
     */
    recipientToken0Account: 8,
    /**
     * The address that receives the collected token_1 protocol fees
     */
    recipientToken1Account: 9,
    /**
     * The SPL program to perform token transfers
     */
    tokenProgram: 10,
    /**
     * The SPL program 2022 to perform token transfers
     */
    tokenProgram2022: 11,
  },
  struct({
    amount0Requested: u64,
    amount1Requested: u64,
  }),
)

/**
 * Collect the fund fee accrued to the pool
 *
 * # Arguments
 *
 * * `ctx` - The context of accounts
 * * `amount_0_requested` - The maximum amount of token_0 to send, can be 0 to collect fees in only token_1
 * * `amount_1_requested` - The maximum amount of token_1 to send, can be 0 to collect fees in only token_0
 *
 */
export interface CollectFundFee {
  amount0Requested: bigint
  amount1Requested: bigint
}

/**
 * Collect the fund fee accrued to the pool
 *
 * # Arguments
 *
 * * `ctx` - The context of accounts
 * * `amount_0_requested` - The maximum amount of token_0 to send, can be 0 to collect fees in only token_1
 * * `amount_1_requested` - The maximum amount of token_1 to send, can be 0 to collect fees in only token_0
 *
 */
export const collectFundFee = instruction(
  {
    d8: '0xa78a4e95dfc2067e',
  },
  {
    /**
     * Only admin or fund_owner can collect fee now
     */
    owner: 0,
    authority: 1,
    /**
     * Pool state stores accumulated protocol fee amount
     */
    poolState: 2,
    /**
     * Amm config account stores fund_owner
     */
    ammConfig: 3,
    /**
     * The address that holds pool tokens for token_0
     */
    token0Vault: 4,
    /**
     * The address that holds pool tokens for token_1
     */
    token1Vault: 5,
    /**
     * The mint of token_0 vault
     */
    vault0Mint: 6,
    /**
     * The mint of token_1 vault
     */
    vault1Mint: 7,
    /**
     * The address that receives the collected token_0 fund fees
     */
    recipientToken0Account: 8,
    /**
     * The address that receives the collected token_1 fund fees
     */
    recipientToken1Account: 9,
    /**
     * The SPL program to perform token transfers
     */
    tokenProgram: 10,
    /**
     * The SPL program 2022 to perform token transfers
     */
    tokenProgram2022: 11,
  },
  struct({
    amount0Requested: u64,
    amount1Requested: u64,
  }),
)

/**
 * Creates a pool for the given token pair and the initial price
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `init_amount_0` - the initial amount_0 to deposit
 * * `init_amount_1` - the initial amount_1 to deposit
 * * `open_time` - the timestamp allowed for swap
 *
 */
export interface Initialize {
  initAmount0: bigint
  initAmount1: bigint
  openTime: bigint
}

/**
 * Creates a pool for the given token pair and the initial price
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `init_amount_0` - the initial amount_0 to deposit
 * * `init_amount_1` - the initial amount_1 to deposit
 * * `open_time` - the timestamp allowed for swap
 *
 */
export const initialize = instruction(
  {
    d8: '0xafaf6d1f0d989bed',
  },
  {
    /**
     * Address paying to create the pool. Can be anyone
     */
    creator: 0,
    /**
     * Which config the pool belongs to.
     */
    ammConfig: 1,
    authority: 2,
    /**
     * Initialize an account to store the pool state
     */
    poolState: 3,
    /**
     * Token_0 mint, the key must smaller then token_1 mint.
     */
    token0Mint: 4,
    /**
     * Token_1 mint, the key must grater then token_0 mint.
     */
    token1Mint: 5,
    /**
     * pool lp mint
     */
    lpMint: 6,
    /**
     * payer token0 account
     */
    creatorToken0: 7,
    /**
     * creator token1 account
     */
    creatorToken1: 8,
    /**
     * creator lp token account
     */
    creatorLpToken: 9,
    token0Vault: 10,
    token1Vault: 11,
    /**
     * create pool fee account
     */
    createPoolFee: 12,
    /**
     * an account to store oracle observations
     */
    observationState: 13,
    /**
     * Program to create mint account and mint tokens
     */
    tokenProgram: 14,
    /**
     * Spl token program or token program 2022
     */
    token0Program: 15,
    /**
     * Spl token program or token program 2022
     */
    token1Program: 16,
    /**
     * Program to create an ATA for receiving position NFT
     */
    associatedTokenProgram: 17,
    /**
     * To create a new program account
     */
    systemProgram: 18,
    /**
     * Sysvar for program account
     */
    rent: 19,
  },
  struct({
    initAmount0: u64,
    initAmount1: u64,
    openTime: u64,
  }),
)

/**
 * Creates a pool for the given token pair and the initial price
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `lp_token_amount` - Pool token amount to transfer. token_a and token_b amount are set by the current exchange rate and size of the pool
 * * `maximum_token_0_amount` -  Maximum token 0 amount to deposit, prevents excessive slippage
 * * `maximum_token_1_amount` - Maximum token 1 amount to deposit, prevents excessive slippage
 *
 */
export interface Deposit {
  lpTokenAmount: bigint
  maximumToken0Amount: bigint
  maximumToken1Amount: bigint
}

/**
 * Creates a pool for the given token pair and the initial price
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `lp_token_amount` - Pool token amount to transfer. token_a and token_b amount are set by the current exchange rate and size of the pool
 * * `maximum_token_0_amount` -  Maximum token 0 amount to deposit, prevents excessive slippage
 * * `maximum_token_1_amount` - Maximum token 1 amount to deposit, prevents excessive slippage
 *
 */
export const deposit = instruction(
  {
    d8: '0xf223c68952e1f2b6',
  },
  {
    /**
     * Pays to mint the position
     */
    owner: 0,
    authority: 1,
    poolState: 2,
    /**
     * Owner lp tokan account
     */
    ownerLpToken: 3,
    /**
     * The payer's token account for token_0
     */
    token0Account: 4,
    /**
     * The payer's token account for token_1
     */
    token1Account: 5,
    /**
     * The address that holds pool tokens for token_0
     */
    token0Vault: 6,
    /**
     * The address that holds pool tokens for token_1
     */
    token1Vault: 7,
    /**
     * token Program
     */
    tokenProgram: 8,
    /**
     * Token program 2022
     */
    tokenProgram2022: 9,
    /**
     * The mint of token_0 vault
     */
    vault0Mint: 10,
    /**
     * The mint of token_1 vault
     */
    vault1Mint: 11,
    /**
     * Lp token mint
     */
    lpMint: 12,
  },
  struct({
    lpTokenAmount: u64,
    maximumToken0Amount: u64,
    maximumToken1Amount: u64,
  }),
)

/**
 * Withdraw lp for token0 ande token1
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `lp_token_amount` - Amount of pool tokens to burn. User receives an output of token a and b based on the percentage of the pool tokens that are returned.
 * * `minimum_token_0_amount` -  Minimum amount of token 0 to receive, prevents excessive slippage
 * * `minimum_token_1_amount` -  Minimum amount of token 1 to receive, prevents excessive slippage
 *
 */
export interface Withdraw {
  lpTokenAmount: bigint
  minimumToken0Amount: bigint
  minimumToken1Amount: bigint
}

/**
 * Withdraw lp for token0 ande token1
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `lp_token_amount` - Amount of pool tokens to burn. User receives an output of token a and b based on the percentage of the pool tokens that are returned.
 * * `minimum_token_0_amount` -  Minimum amount of token 0 to receive, prevents excessive slippage
 * * `minimum_token_1_amount` -  Minimum amount of token 1 to receive, prevents excessive slippage
 *
 */
export const withdraw = instruction(
  {
    d8: '0xb712469c946da122',
  },
  {
    /**
     * Pays to mint the position
     */
    owner: 0,
    authority: 1,
    /**
     * Pool state account
     */
    poolState: 2,
    /**
     * Owner lp token account
     */
    ownerLpToken: 3,
    /**
     * The owner's token account for receive token_0
     */
    token0Account: 4,
    /**
     * The owner's token account for receive token_1
     */
    token1Account: 5,
    /**
     * The address that holds pool tokens for token_0
     */
    token0Vault: 6,
    /**
     * The address that holds pool tokens for token_1
     */
    token1Vault: 7,
    /**
     * token Program
     */
    tokenProgram: 8,
    /**
     * Token program 2022
     */
    tokenProgram2022: 9,
    /**
     * The mint of token_0 vault
     */
    vault0Mint: 10,
    /**
     * The mint of token_1 vault
     */
    vault1Mint: 11,
    /**
     * Pool lp token mint
     */
    lpMint: 12,
    /**
     * memo program
     */
    memoProgram: 13,
  },
  struct({
    lpTokenAmount: u64,
    minimumToken0Amount: u64,
    minimumToken1Amount: u64,
  }),
)

/**
 * Swap the tokens in the pool base input amount
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `amount_in` -  input amount to transfer, output to DESTINATION is based on the exchange rate
 * * `minimum_amount_out` -  Minimum amount of output token, prevents excessive slippage
 *
 */
export interface SwapBaseInput {
  amountIn: bigint
  minimumAmountOut: bigint
}

/**
 * Swap the tokens in the pool base input amount
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `amount_in` -  input amount to transfer, output to DESTINATION is based on the exchange rate
 * * `minimum_amount_out` -  Minimum amount of output token, prevents excessive slippage
 *
 */
export const swapBaseInput = instruction(
  {
    d8: '0x8fbe5adac41e33de',
  },
  {
    /**
     * The user performing the swap
     */
    payer: 0,
    authority: 1,
    /**
     * The factory state to read protocol fees
     */
    ammConfig: 2,
    /**
     * The program account of the pool in which the swap will be performed
     */
    poolState: 3,
    /**
     * The user token account for input token
     */
    inputTokenAccount: 4,
    /**
     * The user token account for output token
     */
    outputTokenAccount: 5,
    /**
     * The vault token account for input token
     */
    inputVault: 6,
    /**
     * The vault token account for output token
     */
    outputVault: 7,
    /**
     * SPL program for input token transfers
     */
    inputTokenProgram: 8,
    /**
     * SPL program for output token transfers
     */
    outputTokenProgram: 9,
    /**
     * The mint of input token
     */
    inputTokenMint: 10,
    /**
     * The mint of output token
     */
    outputTokenMint: 11,
    /**
     * The program account for the most recent oracle observation
     */
    observationState: 12,
  },
  struct({
    amountIn: u64,
    minimumAmountOut: u64,
  }),
)

/**
 * Swap the tokens in the pool base output amount
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `max_amount_in` -  input amount prevents excessive slippage
 * * `amount_out` -  amount of output token
 *
 */
export interface SwapBaseOutput {
  maxAmountIn: bigint
  amountOut: bigint
}

/**
 * Swap the tokens in the pool base output amount
 *
 * # Arguments
 *
 * * `ctx`- The context of accounts
 * * `max_amount_in` -  input amount prevents excessive slippage
 * * `amount_out` -  amount of output token
 *
 */
export const swapBaseOutput = instruction(
  {
    d8: '0x37d96256a34ab4ad',
  },
  {
    /**
     * The user performing the swap
     */
    payer: 0,
    authority: 1,
    /**
     * The factory state to read protocol fees
     */
    ammConfig: 2,
    /**
     * The program account of the pool in which the swap will be performed
     */
    poolState: 3,
    /**
     * The user token account for input token
     */
    inputTokenAccount: 4,
    /**
     * The user token account for output token
     */
    outputTokenAccount: 5,
    /**
     * The vault token account for input token
     */
    inputVault: 6,
    /**
     * The vault token account for output token
     */
    outputVault: 7,
    /**
     * SPL program for input token transfers
     */
    inputTokenProgram: 8,
    /**
     * SPL program for output token transfers
     */
    outputTokenProgram: 9,
    /**
     * The mint of input token
     */
    inputTokenMint: 10,
    /**
     * The mint of output token
     */
    outputTokenMint: 11,
    /**
     * The program account for the most recent oracle observation
     */
    observationState: 12,
  },
  struct({
    maxAmountIn: u64,
    amountOut: u64,
  }),
)
