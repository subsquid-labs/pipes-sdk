import { address, option, struct, u8, u16, u64, unit } from '@subsquid/borsh'
import { instruction } from '../abi.support.js'
import { Fees, LastOrderDistance, NeedTake, SwapInstructionBaseIn, SwapInstructionBaseOut } from './types.js'

export interface Initialize {
  nonce: number
  openTime: bigint
}

export const initialize = instruction(
  {
    d1: '0x00',
  },
  {
    tokenProgram: 0,
    systemProgram: 1,
    rent: 2,
    amm: 3,
    ammAuthority: 4,
    ammOpenOrders: 5,
    lpMintAddress: 6,
    coinMintAddress: 7,
    pcMintAddress: 8,
    poolCoinTokenAccount: 9,
    poolPcTokenAccount: 10,
    poolWithdrawQueue: 11,
    poolTargetOrdersAccount: 12,
    userLpTokenAccount: 13,
    poolTempLpTokenAccount: 14,
    serumProgram: 15,
    serumMarket: 16,
    userWallet: 17,
  },
  struct({
    nonce: u8,
    openTime: u64,
  }),
)

export interface Initialize2 {
  nonce: number
  openTime: bigint
  initPcAmount: bigint
  initCoinAmount: bigint
}

export const initialize2 = instruction(
  {
    d1: '0x01',
  },
  {
    tokenProgram: 0,
    splAssociatedTokenAccount: 1,
    systemProgram: 2,
    rent: 3,
    amm: 4,
    ammAuthority: 5,
    ammOpenOrders: 6,
    lpMint: 7,
    coinMint: 8,
    pcMint: 9,
    poolCoinTokenAccount: 10,
    poolPcTokenAccount: 11,
    poolWithdrawQueue: 12,
    ammTargetOrders: 13,
    poolTempLp: 14,
    serumProgram: 15,
    serumMarket: 16,
    userWallet: 17,
    userTokenCoin: 18,
    userTokenPc: 19,
    userLpTokenAccount: 20,
  },
  struct({
    nonce: u8,
    openTime: u64,
    initPcAmount: u64,
    initCoinAmount: u64,
  }),
)

export interface MonitorStep {
  planOrderLimit: number
  placeOrderLimit: number
  cancelOrderLimit: number
}

export const monitorStep = instruction(
  {
    d1: '0x02',
  },
  {
    tokenProgram: 0,
    rent: 1,
    clock: 2,
    amm: 3,
    ammAuthority: 4,
    ammOpenOrders: 5,
    ammTargetOrders: 6,
    poolCoinTokenAccount: 7,
    poolPcTokenAccount: 8,
    poolWithdrawQueue: 9,
    serumProgram: 10,
    serumMarket: 11,
    serumCoinVaultAccount: 12,
    serumPcVaultAccount: 13,
    serumVaultSigner: 14,
    serumReqQ: 15,
    serumEventQ: 16,
    serumBids: 17,
    serumAsks: 18,
    serumFeeDiscount: 19,
    referrerPcAccount: 20,
  },
  struct({
    planOrderLimit: u16,
    placeOrderLimit: u16,
    cancelOrderLimit: u16,
  }),
)

export interface Deposit {
  maxCoinAmount: bigint
  maxPcAmount: bigint
  baseSide: bigint
}

export const deposit = instruction(
  {
    d1: '0x03',
  },
  {
    tokenProgram: 0,
    amm: 1,
    ammAuthority: 2,
    ammOpenOrders: 3,
    ammTargetOrders: 4,
    lpMintAddress: 5,
    poolCoinTokenAccount: 6,
    poolPcTokenAccount: 7,
    serumMarket: 8,
    userCoinTokenAccount: 9,
    userPcTokenAccount: 10,
    userLpTokenAccount: 11,
    userOwner: 12,
    serumEventQueue: 13,
  },
  struct({
    maxCoinAmount: u64,
    maxPcAmount: u64,
    baseSide: u64,
  }),
)

export interface Withdraw {
  amount: bigint
}

export const withdraw = instruction(
  {
    d1: '0x04',
  },
  {
    tokenProgram: 0,
    amm: 1,
    ammAuthority: 2,
    ammOpenOrders: 3,
    ammTargetOrders: 4,
    lpMintAddress: 5,
    poolCoinTokenAccount: 6,
    poolPcTokenAccount: 7,
    poolWithdrawQueue: 8,
    poolTempLpTokenAccount: 9,
    serumProgram: 10,
    serumMarket: 11,
    serumCoinVaultAccount: 12,
    serumPcVaultAccount: 13,
    serumVaultSigner: 14,
    userLpTokenAccount: 15,
    userCoinTokenAccount: 16,
    userPcTokenAccount: 17,
    userOwner: 18,
    serumEventQ: 19,
    serumBids: 20,
    serumAsks: 21,
  },
  struct({
    amount: u64,
  }),
)

export type MigrateToOpenBook = undefined

export const migrateToOpenBook = instruction(
  {
    d1: '0x05',
  },
  {
    tokenProgram: 0,
    systemProgram: 1,
    rent: 2,
    amm: 3,
    ammAuthority: 4,
    ammOpenOrders: 5,
    ammTokenCoin: 6,
    ammTokenPc: 7,
    ammTargetOrders: 8,
    serumProgram: 9,
    serumMarket: 10,
    serumBids: 11,
    serumAsks: 12,
    serumEventQueue: 13,
    serumCoinVault: 14,
    serumPcVault: 15,
    serumVaultSigner: 16,
    newAmmOpenOrders: 17,
    newSerumProgram: 18,
    newSerumMarket: 19,
    admin: 20,
  },
  unit,
)

export interface SetParams {
  param: number
  value?: bigint | undefined
  newPubkey?: string | undefined
  fees?: Fees | undefined
  lastOrderDistance?: LastOrderDistance | undefined
  needTakeAmounts?: NeedTake | undefined
}

export const setParams = instruction(
  {
    d1: '0x06',
  },
  {
    tokenProgram: 0,
    amm: 1,
    ammAuthority: 2,
    ammOpenOrders: 3,
    ammTargetOrders: 4,
    ammCoinVault: 5,
    ammPcVault: 6,
    serumProgram: 7,
    serumMarket: 8,
    serumCoinVault: 9,
    serumPcVault: 10,
    serumVaultSigner: 11,
    serumEventQueue: 12,
    serumBids: 13,
    serumAsks: 14,
    ammAdminAccount: 15,
    newAmmOpenOrdersAccount: 16,
  },
  struct({
    param: u8,
    value: option(u64),
    newPubkey: option(address),
    fees: option(Fees),
    lastOrderDistance: option(LastOrderDistance),
    needTakeAmounts: option(NeedTake),
  }),
)

export type WithdrawPnl = undefined

export const withdrawPnl = instruction(
  {
    d1: '0x07',
  },
  {
    tokenProgram: 0,
    amm: 1,
    ammConfig: 2,
    ammAuthority: 3,
    ammOpenOrders: 4,
    poolCoinTokenAccount: 5,
    poolPcTokenAccount: 6,
    coinPnlTokenAccount: 7,
    pcPnlTokenAccount: 8,
    pnlOwnerAccount: 9,
    ammTargetOrders: 10,
    serumProgram: 11,
    serumMarket: 12,
    serumEventQueue: 13,
    serumCoinVaultAccount: 14,
    serumPcVaultAccount: 15,
    serumVaultSigner: 16,
    referrerPcAccount: 17,
  },
  unit,
)

export interface WithdrawSrm {
  amount: bigint
}

export const withdrawSrm = instruction(
  {
    d1: '0x08',
  },
  {
    tokenProgram: 0,
    amm: 1,
    ammOwnerAccount: 2,
    ammAuthority: 3,
    srmToken: 4,
    destSrmToken: 5,
  },
  struct({
    amount: u64,
  }),
)

export interface SwapBaseIn {
  amountIn: bigint
  minimumAmountOut: bigint
}

export const swapBaseIn = instruction(
  {
    d1: '0x09',
  },
  {
    tokenProgram: 0,
    amm: 1,
    ammAuthority: 2,
    ammOpenOrders: 3,
    ammTargetOrders: 4,
    poolCoinTokenAccount: 5,
    poolPcTokenAccount: 6,
    serumProgram: 7,
    serumMarket: 8,
    serumBids: 9,
    serumAsks: 10,
    serumEventQueue: 11,
    serumCoinVaultAccount: 12,
    serumPcVaultAccount: 13,
    serumVaultSigner: 14,
    userSourceTokenAccount: 15,
    userDestinationTokenAccount: 16,
    userSourceOwner: 17,
  },
  struct({
    amountIn: u64,
    minimumAmountOut: u64,
  }),
)

export interface PreInitialize {
  nonce: number
}

export const preInitialize = instruction(
  {
    d1: '0x0a',
  },
  {
    tokenProgram: 0,
    systemProgram: 1,
    rent: 2,
    ammTargetOrders: 3,
    poolWithdrawQueue: 4,
    ammAuthority: 5,
    lpMintAddress: 6,
    coinMintAddress: 7,
    pcMintAddress: 8,
    poolCoinTokenAccount: 9,
    poolPcTokenAccount: 10,
    poolTempLpTokenAccount: 11,
    serumMarket: 12,
    userWallet: 13,
  },
  struct({
    nonce: u8,
  }),
)

export interface SwapBaseOut {
  maxAmountIn: bigint
  amountOut: bigint
}

export const swapBaseOut = instruction(
  {
    d1: '0x0b',
  },
  {
    tokenProgram: 0,
    amm: 1,
    ammAuthority: 2,
    ammOpenOrders: 3,
    ammTargetOrders: 4,
    poolCoinTokenAccount: 5,
    poolPcTokenAccount: 6,
    serumProgram: 7,
    serumMarket: 8,
    serumBids: 9,
    serumAsks: 10,
    serumEventQueue: 11,
    serumCoinVaultAccount: 12,
    serumPcVaultAccount: 13,
    serumVaultSigner: 14,
    userSourceTokenAccount: 15,
    userDestinationTokenAccount: 16,
    userSourceOwner: 17,
  },
  struct({
    maxAmountIn: u64,
    amountOut: u64,
  }),
)

export interface SimulateInfo {
  param: number
  swapBaseInValue?: SwapInstructionBaseIn | undefined
  swapBaseOutValue?: SwapInstructionBaseOut | undefined
}

export const simulateInfo = instruction(
  {
    d1: '0x0c',
  },
  {
    amm: 0,
    ammAuthority: 1,
    ammOpenOrders: 2,
    poolCoinTokenAccount: 3,
    poolPcTokenAccount: 4,
    lpMintAddress: 5,
    serumMarket: 6,
    serumEventQueue: 7,
  },
  struct({
    param: u8,
    swapBaseInValue: option(SwapInstructionBaseIn),
    swapBaseOutValue: option(SwapInstructionBaseOut),
  }),
)

export interface AdminCancelOrders {
  limit: number
}

export const adminCancelOrders = instruction(
  {
    d1: '0x0d',
  },
  {
    tokenProgram: 0,
    amm: 1,
    ammAuthority: 2,
    ammOpenOrders: 3,
    ammTargetOrders: 4,
    poolCoinTokenAccount: 5,
    poolPcTokenAccount: 6,
    ammOwnerAccount: 7,
    ammConfig: 8,
    serumProgram: 9,
    serumMarket: 10,
    serumCoinVaultAccount: 11,
    serumPcVaultAccount: 12,
    serumVaultSigner: 13,
    serumEventQ: 14,
    serumBids: 15,
    serumAsks: 16,
  },
  struct({
    limit: u16,
  }),
)

export type CreateConfigAccount = undefined

export const createConfigAccount = instruction(
  {
    d1: '0x0e',
  },
  {
    admin: 0,
    ammConfig: 1,
    owner: 2,
    systemProgram: 3,
    rent: 4,
  },
  unit,
)

export interface UpdateConfigAccount {
  param: number
  owner: string
}

export const updateConfigAccount = instruction(
  {
    d1: '0x0f',
  },
  {
    admin: 0,
    ammConfig: 1,
  },
  struct({
    param: u8,
    owner: address,
  }),
)
