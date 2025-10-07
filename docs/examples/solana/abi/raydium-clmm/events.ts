import { event } from '../abi.support.js'
import {
  CollectPersonalFeeEvent as CollectPersonalFeeEvent_,
  CollectProtocolFeeEvent as CollectProtocolFeeEvent_,
  ConfigChangeEvent as ConfigChangeEvent_,
  CreatePersonalPositionEvent as CreatePersonalPositionEvent_,
  DecreaseLiquidityEvent as DecreaseLiquidityEvent_,
  IncreaseLiquidityEvent as IncreaseLiquidityEvent_,
  LiquidityCalculateEvent as LiquidityCalculateEvent_,
  LiquidityChangeEvent as LiquidityChangeEvent_,
  PoolCreatedEvent as PoolCreatedEvent_,
  SwapEvent as SwapEvent_,
  UpdateRewardInfosEvent as UpdateRewardInfosEvent_,
} from './types.js'

export type ConfigChangeEvent = ConfigChangeEvent_

export const ConfigChangeEvent = event(
  {
    d8: '0xf7bd07776a705f97',
  },
  ConfigChangeEvent_,
)

export type CreatePersonalPositionEvent = CreatePersonalPositionEvent_

export const CreatePersonalPositionEvent = event(
  {
    d8: '0x641e57f9c4df9ace',
  },
  CreatePersonalPositionEvent_,
)

export type IncreaseLiquidityEvent = IncreaseLiquidityEvent_

export const IncreaseLiquidityEvent = event(
  {
    d8: '0x314f69d420221e54',
  },
  IncreaseLiquidityEvent_,
)

export type DecreaseLiquidityEvent = DecreaseLiquidityEvent_

export const DecreaseLiquidityEvent = event(
  {
    d8: '0x3ade563a44325538',
  },
  DecreaseLiquidityEvent_,
)

export type LiquidityCalculateEvent = LiquidityCalculateEvent_

export const LiquidityCalculateEvent = event(
  {
    d8: '0xed7094e63954b4a2',
  },
  LiquidityCalculateEvent_,
)

export type CollectPersonalFeeEvent = CollectPersonalFeeEvent_

export const CollectPersonalFeeEvent = event(
  {
    d8: '0xa6ae69c051a15369',
  },
  CollectPersonalFeeEvent_,
)

export type UpdateRewardInfosEvent = UpdateRewardInfosEvent_

export const UpdateRewardInfosEvent = event(
  {
    d8: '0x6d7fba4e724125ec',
  },
  UpdateRewardInfosEvent_,
)

export type PoolCreatedEvent = PoolCreatedEvent_

export const PoolCreatedEvent = event(
  {
    d8: '0x195e4b2f7063353f',
  },
  PoolCreatedEvent_,
)

export type CollectProtocolFeeEvent = CollectProtocolFeeEvent_

export const CollectProtocolFeeEvent = event(
  {
    d8: '0xce57114f2d29d53d',
  },
  CollectProtocolFeeEvent_,
)

export type SwapEvent = SwapEvent_

export const SwapEvent = event(
  {
    d8: '0x40c6cde8260871e2',
  },
  SwapEvent_,
)

export type LiquidityChangeEvent = LiquidityChangeEvent_

export const LiquidityChangeEvent = event(
  {
    d8: '0x7ef0afce9e58996b',
  },
  LiquidityChangeEvent_,
)
