import { describe, expect, it } from 'vitest'

import { ethereumTraces, mapTraces } from './traces.js'

const HEADER = { number: 21_000_000, hash: '0xblock', timestamp: 1_730_000_000 }

describe('ethereum-traces', () => {
  it('maps a call trace with populated action/result and resolves transaction_hash in-batch', () => {
    const [row] = mapTraces([
      {
        header: HEADER,
        transactions: [{ transactionIndex: 3, hash: '0xtx3' }],
        traces: [
          {
            type: 'call',
            transactionIndex: 3,
            traceAddress: [0, 1],
            subtraces: 2,
            error: null,
            action: {
              callType: 'call',
              from: '0xfrom',
              to: '0xto',
              value: 5n,
              gas: 100_000n,
              input: '0xdead',
            },
            result: { gasUsed: 42_000n, output: '0xbeef' },
          },
        ],
      },
    ])

    expect(row?.['transaction_hash']).toBe('0xtx3')
    expect(row?.['trace_type']).toBe('call')
    expect(row?.['trace_address']).toEqual([0, 1])
    expect(row?.['subtrace_count']).toBe(2)
    expect(row?.['action']).toEqual({
      from_address: '0xfrom',
      to_address: '0xto',
      call_type: 'call',
      gas: 100_000n,
      input: '0xdead',
      value: '5',
      value_lossless: '5',
      init: null,
      author: null,
      reward_type: null,
      refund_address: null,
      refund_balance: null,
      refund_balance_lossless: null,
      self_destructed_address: null,
    })
    expect(row?.['result']).toEqual({ gas_used: 42_000n, output: '0xbeef', address: null, code: null })
  })

  it('maps a reward trace with null transaction linkage', () => {
    const [row] = mapTraces([
      {
        header: HEADER,
        transactions: [],
        traces: [
          {
            type: 'reward',
            transactionIndex: 0,
            traceAddress: [],
            subtraces: 0,
            error: null,
            action: { author: '0xminer', value: 2_000_000_000_000_000_000n, type: 'block' },
          },
        ],
      },
    ])

    expect(row?.['transaction_hash']).toBeNull()
    expect(row?.['transaction_index']).toBeNull()
    expect(row?.['action']).toEqual({
      from_address: null,
      to_address: null,
      call_type: null,
      gas: null,
      input: null,
      value: '2000000000000000000',
      value_lossless: '2000000000000000000',
      init: null,
      author: '0xminer',
      reward_type: 'block',
      refund_address: null,
      refund_balance: null,
      refund_balance_lossless: null,
      self_destructed_address: null,
    })
    expect(row?.['result']).toBeNull()
  })

  it('maps a suicide trace into refund fields', () => {
    const [row] = mapTraces([
      {
        header: HEADER,
        transactions: [{ transactionIndex: 0, hash: '0xtx0' }],
        traces: [
          {
            type: 'suicide',
            transactionIndex: 0,
            traceAddress: [0],
            subtraces: 0,
            error: null,
            action: { address: '0xdead', refundAddress: '0xrefund', balance: 123n },
          },
        ],
      },
    ])

    expect(row?.['action']).toEqual({
      from_address: null,
      to_address: null,
      call_type: null,
      gas: null,
      input: null,
      value: null,
      value_lossless: null,
      init: null,
      author: null,
      reward_type: null,
      refund_address: '0xrefund',
      refund_balance: '123',
      refund_balance_lossless: '123',
      self_destructed_address: '0xdead',
    })
    expect(row?.['result']).toBeNull()
  })

  it('declares STRUCT action (required) and STRUCT result (optional)', () => {
    const schema = ethereumTraces.table.schema

    expect(schema['action']?.type).toBe('STRUCT')
    expect(schema['action']?.optional).toBeUndefined()
    expect(schema['result']?.type).toBe('STRUCT')
    expect(schema['result']?.optional).toBe(true)
  })
})
