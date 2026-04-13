import { address, option, string, struct, u8, u64, unit } from '@subsquid/borsh'
import { instruction } from '../abi.support.js'
import { AuthorityType } from './types.js'

export interface InitializeMint {
  decimals: number
  mintAuthority: string
  freezeAuthority?: string | undefined
}

export const initializeMint = instruction(
  {
    d1: '0x00',
  },
  {
    mint: 0,
    rent: 1,
  },
  struct({
    decimals: u8,
    mintAuthority: address,
    freezeAuthority: option(address),
  }),
)

export type InitializeAccount = undefined

export const initializeAccount = instruction(
  {
    d1: '0x01',
  },
  {
    accountToInitialize: 0,
    mint: 1,
    owner: 2,
    rentSysvar: 3,
  },
  unit,
)

export interface InitializeMultisig {
  noOfSignersRequired: number
}

export const initializeMultisig = instruction(
  {
    d1: '0x02',
  },
  {
    multisig: 0,
    rent: 1,
    signers: 2,
  },
  struct({
    noOfSignersRequired: u8,
  }),
)

export interface Transfer {
  amount: bigint
}

export const transfer = instruction(
  {
    d1: '0x03',
  },
  {
    source: 0,
    destination: 1,
    authority: 2,
    signers: 3,
  },
  struct({
    amount: u64,
  }),
)

export interface Approve {
  amount: bigint
}

export const approve = instruction(
  {
    d1: '0x04',
  },
  {
    source: 0,
    delegate: 1,
    owner: 2,
    signers: 3,
  },
  struct({
    amount: u64,
  }),
)

export type Revoke = undefined

export const revoke = instruction(
  {
    d1: '0x05',
  },
  {
    source: 0,
    owner: 1,
    signers: 2,
  },
  unit,
)

export interface SetAuthority {
  authorityType: AuthorityType
  newAuthority?: string | undefined
}

export const setAuthority = instruction(
  {
    d1: '0x06',
  },
  {
    mint: 0,
    currentAuthority: 1,
    signers: 2,
  },
  struct({
    authorityType: AuthorityType,
    newAuthority: option(address),
  }),
)

export interface MintTo {
  amount: bigint
}

export const mintTo = instruction(
  {
    d1: '0x07',
  },
  {
    mint: 0,
    mintTo: 1,
    mintAuthority: 2,
    signers: 3,
  },
  struct({
    amount: u64,
  }),
)

export interface Burn {
  amount: bigint
}

export const burn = instruction(
  {
    d1: '0x08',
  },
  {
    burnAccount: 0,
    mint: 1,
    owner: 2,
    signers: 3,
  },
  struct({
    amount: u64,
  }),
)

export type CloseAccount = undefined

export const closeAccount = instruction(
  {
    d1: '0x09',
  },
  {
    closeAccount: 0,
    destination: 1,
    owner: 2,
    signers: 3,
  },
  unit,
)

export type FreezeAccount = undefined

export const freezeAccount = instruction(
  {
    d1: '0x0a',
  },
  {
    freezeAccount: 0,
    mint: 1,
    owner: 2,
    signers: 3,
  },
  unit,
)

export type ThawAccount = undefined

export const thawAccount = instruction(
  {
    d1: '0x0b',
  },
  {
    thawAccount: 0,
    mint: 1,
    owner: 2,
    signers: 3,
  },
  unit,
)

export interface TransferChecked {
  amount: bigint
  decimals: number
}

export const transferChecked = instruction(
  {
    d1: '0x0c',
  },
  {
    source: 0,
    tokenMint: 1,
    destination: 2,
    owner: 3,
    signers: 4,
  },
  struct({
    amount: u64,
    decimals: u8,
  }),
)

export interface ApproveChecked {
  amount: bigint
  decimals: number
}

export const approveChecked = instruction(
  {
    d1: '0x0d',
  },
  {
    source: 0,
    tokenMint: 1,
    delegate: 2,
    owner: 3,
    signers: 4,
  },
  struct({
    amount: u64,
    decimals: u8,
  }),
)

export interface MintToChecked {
  amount: bigint
  decimals: number
}

export const mintToChecked = instruction(
  {
    d1: '0x0e',
  },
  {
    tokenMint: 0,
    mintTo: 1,
    mintAuthority: 2,
    signers: 3,
  },
  struct({
    amount: u64,
    decimals: u8,
  }),
)

export interface BurnChecked {
  amount: bigint
  decimals: number
}

export const burnChecked = instruction(
  {
    d1: '0x0f',
  },
  {
    burnAccount: 0,
    tokenMint: 1,
    owner: 2,
    signers: 3,
  },
  struct({
    amount: u64,
    decimals: u8,
  }),
)

export interface InitializeAccount2 {
  owner: string
}

export const initializeAccount2 = instruction(
  {
    d1: '0x10',
  },
  {
    initializeAccount: 0,
    associatedMint: 1,
    rentSysvar: 2,
  },
  struct({
    owner: address,
  }),
)

export type SyncNative = undefined

export const syncNative = instruction(
  {
    d1: '0x11',
  },
  {
    nativeTokenAccount: 0,
  },
  unit,
)

export interface InitializeAccount3 {
  owner: string
}

export const initializeAccount3 = instruction(
  {
    d1: '0x12',
  },
  {
    initializeAccount: 0,
    associatedMint: 1,
  },
  struct({
    owner: address,
  }),
)

export interface InitializeMultisig2 {
  m: number
}

export const initializeMultisig2 = instruction(
  {
    d1: '0x13',
  },
  {
    initializeAccount: 0,
    signers: 1,
  },
  struct({
    m: u8,
  }),
)

export interface InitializeMint2 {
  decimals: number
  mintAuthority: string
  freezeAuthority?: string | undefined
}

export const initializeMint2 = instruction(
  {
    d1: '0x14',
  },
  {
    mint: 0,
  },
  struct({
    decimals: u8,
    mintAuthority: address,
    freezeAuthority: option(address),
  }),
)

export type GetAccountDataSize = undefined

export const getAccountDataSize = instruction(
  {
    d1: '0x15',
  },
  {
    mint: 0,
  },
  unit,
)

export type InitializeImmutableOwner = undefined

export const initializeImmutableOwner = instruction(
  {
    d1: '0x16',
  },
  {
    initializeAccount: 0,
  },
  unit,
)

export interface AmountToUiAmount {
  amount: bigint
}

export const amountToUiAmount = instruction(
  {
    d1: '0x17',
  },
  {
    mint: 0,
  },
  struct({
    amount: u64,
  }),
)

export interface UiAmountToAmount {
  uiAmount: string
}

export const uiAmountToAmount = instruction(
  {
    d1: '0x18',
  },
  {
    mint: 0,
  },
  struct({
    uiAmount: string,
  }),
)
