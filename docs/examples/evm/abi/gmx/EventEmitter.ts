import type { EventParams as EParams, FunctionArguments, FunctionReturn } from '@subsquid/evm-abi'
import { ContractBase, event, fun, indexed, viewFun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

export const events = {
  EventLog: event(
    '0x7e3bde2ba7aca4a8499608ca57f3b0c1c1c93ace63ffd3741a9fab204146fc9a',
    'EventLog(address,string,string,(((string,address)[],(string,address[])[]),((string,uint256)[],(string,uint256[])[]),((string,int256)[],(string,int256[])[]),((string,bool)[],(string,bool[])[]),((string,bytes32)[],(string,bytes32[])[]),((string,bytes)[],(string,bytes[])[]),((string,string)[],(string,string[])[])))',
    {
      msgSender: p.address,
      eventName: p.string,
      eventNameHash: indexed(p.string),
      eventData: p.struct({
        addressItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.address })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.address) })),
        }),
        uintItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.uint256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.uint256) })),
        }),
        intItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.int256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.int256) })),
        }),
        boolItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bool })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bool) })),
        }),
        bytes32Items: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes32 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes32) })),
        }),
        bytesItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes) })),
        }),
        stringItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.string })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.string) })),
        }),
      }),
    },
  ),
  EventLog1: event(
    '0x137a44067c8961cd7e1d876f4754a5a3a75989b4552f1843fc69c3b372def160',
    'EventLog1(address,string,string,bytes32,(((string,address)[],(string,address[])[]),((string,uint256)[],(string,uint256[])[]),((string,int256)[],(string,int256[])[]),((string,bool)[],(string,bool[])[]),((string,bytes32)[],(string,bytes32[])[]),((string,bytes)[],(string,bytes[])[]),((string,string)[],(string,string[])[])))',
    {
      msgSender: p.address,
      eventName: p.string,
      eventNameHash: indexed(p.string), // topic1
      topic1: indexed(p.bytes32), // topic2
      eventData: p.struct({
        addressItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.address })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.address) })),
        }),
        uintItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.uint256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.uint256) })),
        }),
        intItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.int256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.int256) })),
        }),
        boolItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bool })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bool) })),
        }),
        bytes32Items: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes32 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes32) })),
        }),
        bytesItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes) })),
        }),
        stringItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.string })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.string) })),
        }),
      }),
    },
  ),
  EventLog2: event(
    '0x468a25a7ba624ceea6e540ad6f49171b52495b648417ae91bca21676d8a24dc5',
    'EventLog2(address,string,string,bytes32,bytes32,(((string,address)[],(string,address[])[]),((string,uint256)[],(string,uint256[])[]),((string,int256)[],(string,int256[])[]),((string,bool)[],(string,bool[])[]),((string,bytes32)[],(string,bytes32[])[]),((string,bytes)[],(string,bytes[])[]),((string,string)[],(string,string[])[])))',
    {
      msgSender: p.address,
      eventName: p.string,
      eventNameHash: indexed(p.string),
      topic1: indexed(p.bytes32),
      topic2: indexed(p.bytes32),
      eventData: p.struct({
        addressItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.address })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.address) })),
        }),
        uintItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.uint256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.uint256) })),
        }),
        intItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.int256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.int256) })),
        }),
        boolItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bool })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bool) })),
        }),
        bytes32Items: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes32 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes32) })),
        }),
        bytesItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes) })),
        }),
        stringItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.string })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.string) })),
        }),
      }),
    },
  ),
}

export const functions = {
  emitDataLog1: fun('0xf9d5c0ea', 'emitDataLog1(bytes32,bytes)', { topic1: p.bytes32, data: p.bytes }),
  emitDataLog2: fun('0xdda0db32', 'emitDataLog2(bytes32,bytes32,bytes)', {
    topic1: p.bytes32,
    topic2: p.bytes32,
    data: p.bytes,
  }),
  emitDataLog3: fun('0xb3ac1c38', 'emitDataLog3(bytes32,bytes32,bytes32,bytes)', {
    topic1: p.bytes32,
    topic2: p.bytes32,
    topic3: p.bytes32,
    data: p.bytes,
  }),
  emitDataLog4: fun('0xee288ce8', 'emitDataLog4(bytes32,bytes32,bytes32,bytes32,bytes)', {
    topic1: p.bytes32,
    topic2: p.bytes32,
    topic3: p.bytes32,
    topic4: p.bytes32,
    data: p.bytes,
  }),
  emitEventLog: fun(
    '0x906c49f6',
    'emitEventLog(string,(((string,address)[],(string,address[])[]),((string,uint256)[],(string,uint256[])[]),((string,int256)[],(string,int256[])[]),((string,bool)[],(string,bool[])[]),((string,bytes32)[],(string,bytes32[])[]),((string,bytes)[],(string,bytes[])[]),((string,string)[],(string,string[])[])))',
    {
      eventName: p.string,
      eventData: p.struct({
        addressItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.address })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.address) })),
        }),
        uintItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.uint256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.uint256) })),
        }),
        intItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.int256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.int256) })),
        }),
        boolItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bool })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bool) })),
        }),
        bytes32Items: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes32 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes32) })),
        }),
        bytesItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes) })),
        }),
        stringItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.string })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.string) })),
        }),
      }),
    },
  ),
  emitEventLog1: fun(
    '0x24de01e4',
    'emitEventLog1(string,bytes32,(((string,address)[],(string,address[])[]),((string,uint256)[],(string,uint256[])[]),((string,int256)[],(string,int256[])[]),((string,bool)[],(string,bool[])[]),((string,bytes32)[],(string,bytes32[])[]),((string,bytes)[],(string,bytes[])[]),((string,string)[],(string,string[])[])))',
    {
      eventName: p.string,
      topic1: p.bytes32,
      eventData: p.struct({
        addressItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.address })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.address) })),
        }),
        uintItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.uint256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.uint256) })),
        }),
        intItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.int256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.int256) })),
        }),
        boolItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bool })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bool) })),
        }),
        bytes32Items: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes32 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes32) })),
        }),
        bytesItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes) })),
        }),
        stringItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.string })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.string) })),
        }),
      }),
    },
  ),
  emitEventLog2: fun(
    '0x63d16363',
    'emitEventLog2(string,bytes32,bytes32,(((string,address)[],(string,address[])[]),((string,uint256)[],(string,uint256[])[]),((string,int256)[],(string,int256[])[]),((string,bool)[],(string,bool[])[]),((string,bytes32)[],(string,bytes32[])[]),((string,bytes)[],(string,bytes[])[]),((string,string)[],(string,string[])[])))',
    {
      eventName: p.string,
      topic1: p.bytes32,
      topic2: p.bytes32,
      eventData: p.struct({
        addressItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.address })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.address) })),
        }),
        uintItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.uint256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.uint256) })),
        }),
        intItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.int256 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.int256) })),
        }),
        boolItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bool })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bool) })),
        }),
        bytes32Items: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes32 })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes32) })),
        }),
        bytesItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.bytes })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.bytes) })),
        }),
        stringItems: p.struct({
          items: p.array(p.struct({ key: p.string, value: p.string })),
          arrayItems: p.array(p.struct({ key: p.string, value: p.array(p.string) })),
        }),
      }),
    },
  ),
  roleStore: viewFun('0x4a4a7b04', 'roleStore()', {}, p.address),
}

export class Contract extends ContractBase {
  roleStore() {
    return this.eth_call(functions.roleStore, {})
  }
}

/// Event types
export type EventLogEventArgs = EParams<typeof events.EventLog>
export type EventLog1EventArgs = EParams<typeof events.EventLog1>
export type EventLog2EventArgs = EParams<typeof events.EventLog2>

/// Function types
export type EmitDataLog1Params = FunctionArguments<typeof functions.emitDataLog1>
export type EmitDataLog1Return = FunctionReturn<typeof functions.emitDataLog1>

export type EmitDataLog2Params = FunctionArguments<typeof functions.emitDataLog2>
export type EmitDataLog2Return = FunctionReturn<typeof functions.emitDataLog2>

export type EmitDataLog3Params = FunctionArguments<typeof functions.emitDataLog3>
export type EmitDataLog3Return = FunctionReturn<typeof functions.emitDataLog3>

export type EmitDataLog4Params = FunctionArguments<typeof functions.emitDataLog4>
export type EmitDataLog4Return = FunctionReturn<typeof functions.emitDataLog4>

export type EmitEventLogParams = FunctionArguments<typeof functions.emitEventLog>
export type EmitEventLogReturn = FunctionReturn<typeof functions.emitEventLog>

export type EmitEventLog1Params = FunctionArguments<typeof functions.emitEventLog1>
export type EmitEventLog1Return = FunctionReturn<typeof functions.emitEventLog1>

export type EmitEventLog2Params = FunctionArguments<typeof functions.emitEventLog2>
export type EmitEventLog2Return = FunctionReturn<typeof functions.emitEventLog2>

export type RoleStoreParams = FunctionArguments<typeof functions.roleStore>
export type RoleStoreReturn = FunctionReturn<typeof functions.roleStore>
