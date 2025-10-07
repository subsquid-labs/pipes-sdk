import { event } from '../abi.support.js'
import {
  Deposit as Deposit_,
  Init as Init_,
  SwapBaseIn as SwapBaseIn_,
  SwapBaseOut as SwapBaseOut_,
  Withdraw as Withdraw_,
} from './types'

export type Init = Init_

export const Init = event(
  {
    d8: '0x03df716e0d67640b',
  },
  Init_,
)

export type Deposit = Deposit_

export const Deposit = event(
  {
    d8: '0x3ecdf2aff4a98834',
  },
  Deposit_,
)

export type Withdraw = Withdraw_

export const Withdraw = event(
  {
    d8: '0xc0f1c9d946965af7',
  },
  Withdraw_,
)

export type SwapBaseIn = SwapBaseIn_

export const SwapBaseIn = event(
  {
    d8: '0x05bde5c969e21391',
  },
  SwapBaseIn_,
)

export type SwapBaseOut = SwapBaseOut_

export const SwapBaseOut = event(
  {
    d8: '0x835c51b828654810',
  },
  SwapBaseOut_,
)
