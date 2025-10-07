import { event } from '../abi.support.js'
import { LpChangeEvent as LpChangeEvent_, SwapEvent as SwapEvent_ } from './types.js'

export type LpChangeEvent = LpChangeEvent_

export const LpChangeEvent = event(
  {
    d8: '0x79a3cdc939da753c',
  },
  LpChangeEvent_,
)

export type SwapEvent = SwapEvent_

export const SwapEvent = event(
  {
    d8: '0x40c6cde8260871e2',
  },
  SwapEvent_,
)
