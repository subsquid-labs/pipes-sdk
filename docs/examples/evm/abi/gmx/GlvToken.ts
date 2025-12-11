import * as p from '@subsquid/evm-codec'
import { event, fun, viewFun, indexed, ContractBase } from '@subsquid/evm-abi'
import type { EventParams as EParams, FunctionArguments, FunctionReturn } from '@subsquid/evm-abi'

export const events = {
    Approval: event("0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925", "Approval(address,address,uint256)", {"owner": indexed(p.address), "spender": indexed(p.address), "value": p.uint256}),
    Transfer: event("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "Transfer(address,address,uint256)", {"from": indexed(p.address), "to": indexed(p.address), "value": p.uint256}),
}

export const functions = {
    allowance: viewFun("0xdd62ed3e", "allowance(address,address)", {"owner": p.address, "spender": p.address}, p.uint256),
    approve: fun("0x095ea7b3", "approve(address,uint256)", {"spender": p.address, "amount": p.uint256}, p.bool),
    balanceOf: viewFun("0x70a08231", "balanceOf(address)", {"account": p.address}, p.uint256),
    burn: fun("0x9dc29fac", "burn(address,uint256)", {"account": p.address, "amount": p.uint256}, ),
    dataStore: viewFun("0x660d0d67", "dataStore()", {}, p.address),
    decimals: viewFun("0x313ce567", "decimals()", {}, p.uint8),
    decreaseAllowance: fun("0xa457c2d7", "decreaseAllowance(address,uint256)", {"spender": p.address, "subtractedValue": p.uint256}, p.bool),
    increaseAllowance: fun("0x39509351", "increaseAllowance(address,uint256)", {"spender": p.address, "addedValue": p.uint256}, p.bool),
    mint: fun("0x40c10f19", "mint(address,uint256)", {"account": p.address, "amount": p.uint256}, ),
    name: viewFun("0x06fdde03", "name()", {}, p.string),
    recordTransferIn: fun("0x352f9aed", "recordTransferIn(address)", {"token": p.address}, p.uint256),
    roleStore: viewFun("0x4a4a7b04", "roleStore()", {}, p.address),
    symbol: viewFun("0x95d89b41", "symbol()", {}, p.string),
    syncTokenBalance: fun("0xeb40133f", "syncTokenBalance(address)", {"token": p.address}, p.uint256),
    tokenBalances: viewFun("0x523fba7f", "tokenBalances(address)", {"_0": p.address}, p.uint256),
    totalSupply: viewFun("0x18160ddd", "totalSupply()", {}, p.uint256),
    transfer: fun("0xa9059cbb", "transfer(address,uint256)", {"to": p.address, "amount": p.uint256}, p.bool),
    transferFrom: fun("0x23b872dd", "transferFrom(address,address,uint256)", {"from": p.address, "to": p.address, "amount": p.uint256}, p.bool),
    'transferOut(address,address,uint256)': fun("0x078d3b79", "transferOut(address,address,uint256)", {"token": p.address, "receiver": p.address, "amount": p.uint256}, ),
    'transferOut(address,address,uint256,bool)': fun("0x2fb12605", "transferOut(address,address,uint256,bool)", {"token": p.address, "receiver": p.address, "amount": p.uint256, "shouldUnwrapNativeToken": p.bool}, ),
    transferOutNativeToken: fun("0xd443ca94", "transferOutNativeToken(address,uint256)", {"receiver": p.address, "amount": p.uint256}, ),
}

export class Contract extends ContractBase {

    allowance(owner: AllowanceParams["owner"], spender: AllowanceParams["spender"]) {
        return this.eth_call(functions.allowance, {owner, spender})
    }

    balanceOf(account: BalanceOfParams["account"]) {
        return this.eth_call(functions.balanceOf, {account})
    }

    dataStore() {
        return this.eth_call(functions.dataStore, {})
    }

    decimals() {
        return this.eth_call(functions.decimals, {})
    }

    name() {
        return this.eth_call(functions.name, {})
    }

    roleStore() {
        return this.eth_call(functions.roleStore, {})
    }

    symbol() {
        return this.eth_call(functions.symbol, {})
    }

    tokenBalances(_0: TokenBalancesParams["_0"]) {
        return this.eth_call(functions.tokenBalances, {_0})
    }

    totalSupply() {
        return this.eth_call(functions.totalSupply, {})
    }
}

/// Event types
export type ApprovalEventArgs = EParams<typeof events.Approval>
export type TransferEventArgs = EParams<typeof events.Transfer>

/// Function types
export type AllowanceParams = FunctionArguments<typeof functions.allowance>
export type AllowanceReturn = FunctionReturn<typeof functions.allowance>

export type ApproveParams = FunctionArguments<typeof functions.approve>
export type ApproveReturn = FunctionReturn<typeof functions.approve>

export type BalanceOfParams = FunctionArguments<typeof functions.balanceOf>
export type BalanceOfReturn = FunctionReturn<typeof functions.balanceOf>

export type BurnParams = FunctionArguments<typeof functions.burn>
export type BurnReturn = FunctionReturn<typeof functions.burn>

export type DataStoreParams = FunctionArguments<typeof functions.dataStore>
export type DataStoreReturn = FunctionReturn<typeof functions.dataStore>

export type DecimalsParams = FunctionArguments<typeof functions.decimals>
export type DecimalsReturn = FunctionReturn<typeof functions.decimals>

export type DecreaseAllowanceParams = FunctionArguments<typeof functions.decreaseAllowance>
export type DecreaseAllowanceReturn = FunctionReturn<typeof functions.decreaseAllowance>

export type IncreaseAllowanceParams = FunctionArguments<typeof functions.increaseAllowance>
export type IncreaseAllowanceReturn = FunctionReturn<typeof functions.increaseAllowance>

export type MintParams = FunctionArguments<typeof functions.mint>
export type MintReturn = FunctionReturn<typeof functions.mint>

export type NameParams = FunctionArguments<typeof functions.name>
export type NameReturn = FunctionReturn<typeof functions.name>

export type RecordTransferInParams = FunctionArguments<typeof functions.recordTransferIn>
export type RecordTransferInReturn = FunctionReturn<typeof functions.recordTransferIn>

export type RoleStoreParams = FunctionArguments<typeof functions.roleStore>
export type RoleStoreReturn = FunctionReturn<typeof functions.roleStore>

export type SymbolParams = FunctionArguments<typeof functions.symbol>
export type SymbolReturn = FunctionReturn<typeof functions.symbol>

export type SyncTokenBalanceParams = FunctionArguments<typeof functions.syncTokenBalance>
export type SyncTokenBalanceReturn = FunctionReturn<typeof functions.syncTokenBalance>

export type TokenBalancesParams = FunctionArguments<typeof functions.tokenBalances>
export type TokenBalancesReturn = FunctionReturn<typeof functions.tokenBalances>

export type TotalSupplyParams = FunctionArguments<typeof functions.totalSupply>
export type TotalSupplyReturn = FunctionReturn<typeof functions.totalSupply>

export type TransferParams = FunctionArguments<typeof functions.transfer>
export type TransferReturn = FunctionReturn<typeof functions.transfer>

export type TransferFromParams = FunctionArguments<typeof functions.transferFrom>
export type TransferFromReturn = FunctionReturn<typeof functions.transferFrom>

export type TransferOutParams_0 = FunctionArguments<typeof functions['transferOut(address,address,uint256)']>
export type TransferOutReturn_0 = FunctionReturn<typeof functions['transferOut(address,address,uint256)']>

export type TransferOutParams_1 = FunctionArguments<typeof functions['transferOut(address,address,uint256,bool)']>
export type TransferOutReturn_1 = FunctionReturn<typeof functions['transferOut(address,address,uint256,bool)']>

export type TransferOutNativeTokenParams = FunctionArguments<typeof functions.transferOutNativeToken>
export type TransferOutNativeTokenReturn = FunctionReturn<typeof functions.transferOutNativeToken>

