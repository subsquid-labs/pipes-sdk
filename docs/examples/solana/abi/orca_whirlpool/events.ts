import { event } from '../abi.support'
import {
  LiquidityDecreased as LiquidityDecreased_,
  LiquidityIncreased as LiquidityIncreased_,
  Traded as Traded_,
} from './types'

export type LiquidityDecreased = LiquidityDecreased_

export const LiquidityDecreased = event(
  {
    d8: '0xa601244770cab5ab',
  },
  LiquidityDecreased_,
)

export type LiquidityIncreased = LiquidityIncreased_

export const LiquidityIncreased = event(
  {
    d8: '0x1e0790b566fe9ba1',
  },
  LiquidityIncreased_,
)

export type Traded = Traded_

export const Traded = event(
  {
    d8: '0xe1ca49af932ba096',
  },
  Traded_,
)
