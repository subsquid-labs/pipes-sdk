import type { EventParams as EParams, FunctionArguments, FunctionReturn } from '@subsquid/evm-abi'
import { ContractBase, event, fun, indexed, viewFun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

export const events = {
  FeeAmountEnabled: event(
    '0xc66a3fdf07232cdd185febcc6579d408c241b47ae2f9907d84be655141eeaecc'.toLowerCase(),
    'FeeAmountEnabled(uint24,int24)',
    { fee: indexed(p.uint24), tickSpacing: indexed(p.int24) },
  ),
  OwnerChanged: event(
    '0xb532073b38c83145e3e5135377a08bf9aab55bc0fd7c1179cd4fb995d2a5159c'.toLowerCase(),
    'OwnerChanged(address,address)',
    { oldOwner: indexed(p.address), newOwner: indexed(p.address) },
  ),
  PoolCreated: event(
    '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118'.toLowerCase(),
    'PoolCreated(address,address,uint24,int24,address)',
    {
      token0: indexed(p.address),
      token1: indexed(p.address),
      fee: indexed(p.uint24),
      tickSpacing: p.int24,
      pool: p.address,
    },
  ),
}

export const functions = {
  createPool: fun(
    '0xa1671295',
    'createPool(address,address,uint24)',
    { tokenA: p.address, tokenB: p.address, fee: p.uint24 },
    p.address,
  ),
  enableFeeAmount: fun('0x8a7c195f', 'enableFeeAmount(uint24,int24)', {
    fee: p.uint24,
    tickSpacing: p.int24,
  }),
  feeAmountTickSpacing: viewFun('0x22afcccb', 'feeAmountTickSpacing(uint24)', { fee: p.uint24 }, p.int24),
  getPool: viewFun(
    '0x1698ee82',
    'getPool(address,address,uint24)',
    { tokenA: p.address, tokenB: p.address, fee: p.uint24 },
    p.address,
  ),
  owner: viewFun('0x8da5cb5b', 'owner()', {}, p.address),
  setOwner: fun('0x13af4035', 'setOwner(address)', { _owner: p.address }),
}

export class Contract extends ContractBase {
  feeAmountTickSpacing(fee: FeeAmountTickSpacingParams['fee']) {
    return this.eth_call(functions.feeAmountTickSpacing, { fee })
  }

  getPool(tokenA: GetPoolParams['tokenA'], tokenB: GetPoolParams['tokenB'], fee: GetPoolParams['fee']) {
    return this.eth_call(functions.getPool, { tokenA, tokenB, fee })
  }

  owner() {
    return this.eth_call(functions.owner, {})
  }
}

/// Event types
export type FeeAmountEnabledEventArgs = EParams<typeof events.FeeAmountEnabled>
export type OwnerChangedEventArgs = EParams<typeof events.OwnerChanged>
export type PoolCreatedEventArgs = EParams<typeof events.PoolCreated>

/// Function types
export type CreatePoolParams = FunctionArguments<typeof functions.createPool>
export type CreatePoolReturn = FunctionReturn<typeof functions.createPool>

export type EnableFeeAmountParams = FunctionArguments<typeof functions.enableFeeAmount>
export type EnableFeeAmountReturn = FunctionReturn<typeof functions.enableFeeAmount>

export type FeeAmountTickSpacingParams = FunctionArguments<typeof functions.feeAmountTickSpacing>
export type FeeAmountTickSpacingReturn = FunctionReturn<typeof functions.feeAmountTickSpacing>

export type GetPoolParams = FunctionArguments<typeof functions.getPool>
export type GetPoolReturn = FunctionReturn<typeof functions.getPool>

export type OwnerParams = FunctionArguments<typeof functions.owner>
export type OwnerReturn = FunctionReturn<typeof functions.owner>

export type SetOwnerParams = FunctionArguments<typeof functions.setOwner>
export type SetOwnerReturn = FunctionReturn<typeof functions.setOwner>
