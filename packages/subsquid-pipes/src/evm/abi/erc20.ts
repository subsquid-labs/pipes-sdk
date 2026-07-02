import type { EventParams as EParams, FunctionArguments, FunctionReturn } from '@subsquid/evm-abi'
import { ContractBase, event, fun, indexed, viewFun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

export const events = {
  Approval: event(
    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
    'Approval(address,address,uint256)',
    { owner: indexed(p.address), spender: indexed(p.address), value: p.uint256 },
  ),
  Transfer: event(
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    'Transfer(address,address,uint256)',
    { from: indexed(p.address), to: indexed(p.address), value: p.uint256 },
  ),
}

export const functions = {
  name: viewFun('0x06fdde03', 'name()', {}, p.string),
  approve: fun('0x095ea7b3', 'approve(address,uint256)', { _spender: p.address, _value: p.uint256 }, p.bool),
  totalSupply: viewFun('0x18160ddd', 'totalSupply()', {}, p.uint256),
  transferFrom: fun(
    '0x23b872dd',
    'transferFrom(address,address,uint256)',
    { _from: p.address, _to: p.address, _value: p.uint256 },
    p.bool,
  ),
  decimals: viewFun('0x313ce567', 'decimals()', {}, p.uint8),
  balanceOf: viewFun('0x70a08231', 'balanceOf(address)', { _owner: p.address }, p.uint256),
  symbol: viewFun('0x95d89b41', 'symbol()', {}, p.string),
  transfer: fun('0xa9059cbb', 'transfer(address,uint256)', { _to: p.address, _value: p.uint256 }, p.bool),
  allowance: viewFun('0xdd62ed3e', 'allowance(address,address)', { _owner: p.address, _spender: p.address }, p.uint256),
}

/**
 * Standard ERC20 ABI in JSON form, for libraries that consume a plain ABI array
 * (e.g. `viem`). The {@link events}/{@link functions} descriptors above are the
 * `@subsquid/evm-abi` codecs used for decoding; this is the same interface in
 * the interchange shape used for encoding and external tooling.
 */
export const abi = [
  {
    type: 'event',
    name: 'Approval',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_spender', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transferFrom',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_from', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: '_owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export class Contract extends ContractBase {
  name() {
    return this.eth_call(functions.name, {})
  }

  totalSupply() {
    return this.eth_call(functions.totalSupply, {})
  }

  decimals() {
    return this.eth_call(functions.decimals, {})
  }

  balanceOf(_owner: BalanceOfParams['_owner']) {
    return this.eth_call(functions.balanceOf, { _owner })
  }

  symbol() {
    return this.eth_call(functions.symbol, {})
  }

  allowance(_owner: AllowanceParams['_owner'], _spender: AllowanceParams['_spender']) {
    return this.eth_call(functions.allowance, { _owner, _spender })
  }
}

/// Event types
export type ApprovalEventArgs = EParams<typeof events.Approval>
export type TransferEventArgs = EParams<typeof events.Transfer>

/// Function types
export type NameParams = FunctionArguments<typeof functions.name>
export type NameReturn = FunctionReturn<typeof functions.name>

export type ApproveParams = FunctionArguments<typeof functions.approve>
export type ApproveReturn = FunctionReturn<typeof functions.approve>

export type TotalSupplyParams = FunctionArguments<typeof functions.totalSupply>
export type TotalSupplyReturn = FunctionReturn<typeof functions.totalSupply>

export type TransferFromParams = FunctionArguments<typeof functions.transferFrom>
export type TransferFromReturn = FunctionReturn<typeof functions.transferFrom>

export type DecimalsParams = FunctionArguments<typeof functions.decimals>
export type DecimalsReturn = FunctionReturn<typeof functions.decimals>

export type BalanceOfParams = FunctionArguments<typeof functions.balanceOf>
export type BalanceOfReturn = FunctionReturn<typeof functions.balanceOf>

export type SymbolParams = FunctionArguments<typeof functions.symbol>
export type SymbolReturn = FunctionReturn<typeof functions.symbol>

export type TransferParams = FunctionArguments<typeof functions.transfer>
export type TransferReturn = FunctionReturn<typeof functions.transfer>

export type AllowanceParams = FunctionArguments<typeof functions.allowance>
export type AllowanceReturn = FunctionReturn<typeof functions.allowance>
