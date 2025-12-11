import * as p from '@subsquid/evm-codec'
import { event, fun, viewFun, indexed, ContractBase } from '@subsquid/evm-abi'
import type { EventParams as EParams, FunctionArguments, FunctionReturn } from '@subsquid/evm-abi'

export const events = {
    BatchSend: event("0xa1552778fd4edc5098fd82f614c100bf0f42c781e7926907643e2894679da0f3", "BatchSend(uint256,address,address[],uint256[])", {"typeId": indexed(p.uint256), "token": indexed(p.address), "accounts": p.array(p.address), "amounts": p.array(p.uint256)}),
}

export const functions = {
    admin: viewFun("0xf851a440", "admin()", {}, p.address),
    send: fun("0xf8129cd2", "send(address,address[],uint256[])", {"_token": p.address, "_accounts": p.array(p.address), "_amounts": p.array(p.uint256)}, ),
    sendAndEmit: fun("0x745ae40b", "sendAndEmit(address,address[],uint256[],uint256)", {"_token": p.address, "_accounts": p.array(p.address), "_amounts": p.array(p.uint256), "_typeId": p.uint256}, ),
}

export class Contract extends ContractBase {

    admin() {
        return this.eth_call(functions.admin, {})
    }
}

/// Event types
export type BatchSendEventArgs = EParams<typeof events.BatchSend>

/// Function types
export type AdminParams = FunctionArguments<typeof functions.admin>
export type AdminReturn = FunctionReturn<typeof functions.admin>

export type SendParams = FunctionArguments<typeof functions.send>
export type SendReturn = FunctionReturn<typeof functions.send>

export type SendAndEmitParams = FunctionArguments<typeof functions.sendAndEmit>
export type SendAndEmitReturn = FunctionReturn<typeof functions.sendAndEmit>

