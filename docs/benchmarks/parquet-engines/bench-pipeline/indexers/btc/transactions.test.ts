import { afterEach, describe, expect, it } from 'vitest'

import { type MockPortal, mockPortal, readAll } from '../../../../../../packages/pipes/src/testing/index.js'
import { btcTransactions, mapTransactions } from './transactions.js'

const HEADER = { number: 900_000, hash: '0000block', timestamp: 1_747_749_600 }

function block(overrides: Record<string, unknown> = {}) {
  return {
    header: HEADER,
    transactions: [{ transactionIndex: 1, txid: 'txid-1', size: 250, vsize: 140, version: 2, locktime: 0 }],
    inputs: [
      {
        transactionIndex: 1,
        inputIndex: 0,
        type: 'witness_v0_keyhash',
        prevoutValue: 0.001,
        txid: 'prev-txid',
        vout: 3,
        scriptSigHex: '',
        scriptSigAsm: '',
        sequence: 4294967293,
        prevoutScriptPubKeyType: 'witness_v0_keyhash',
        prevoutScriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
      },
    ],
    outputs: [
      {
        transactionIndex: 1,
        outputIndex: 0,
        value: 0.0009,
        scriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
        scriptPubKeyAsm: '0 751e…',
        scriptPubKeyType: 'witness_v0_keyhash',
      },
    ],
    ...overrides,
  }
}

describe('btc-transactions', () => {
  let portal: MockPortal | undefined

  afterEach(async () => {
    await portal?.close()
    portal = undefined
  })

  it('joins inputs/outputs by transactionIndex and computes satoshi sums + fee as decimal strings', () => {
    const [row] = mapTransactions([block()])

    expect(row['hash']).toBe('txid-1')
    expect(row['block_number']).toBe(900_000)
    expect(row['block_timestamp']).toBe(1_747_749_600_000)
    expect(row['input_count']).toBe(1)
    expect(row['output_count']).toBe(1)
    expect(row['input_value']).toBe('100000')
    expect(row['output_value']).toBe('90000')
    expect(row['fee']).toBe('10000')
    expect(row['is_coinbase']).toBe(false)

    const input = (row['inputs'] as any[])[0]
    expect(input.spent_transaction_hash).toBe('prev-txid')
    expect(input.spent_output_index).toBe(3)
    expect(input.value).toBe('100000')
    expect(input.addresses).toEqual(['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'])

    const output = (row['outputs'] as any[])[0]
    expect(output.value).toBe('90000')
    expect(output.type).toBe('witness_v0_keyhash')
  })

  it('nulls prevout fields for coinbase inputs and zeroes the fee', () => {
    const [row] = mapTransactions([
      block({
        inputs: [
          {
            transactionIndex: 1,
            inputIndex: 0,
            type: 'coinbase',
            coinbase: '03abcd',
            sequence: 4294967295,
          },
        ],
      }),
    ])

    expect(row['is_coinbase']).toBe(true)
    expect(row['fee']).toBe('0')

    const input = (row['inputs'] as any[])[0]
    expect(input.spent_transaction_hash).toBeNull()
    expect(input.spent_output_index).toBeNull()
    expect(input.script_hex).toBe('03abcd')
    expect(input.type).toBeNull()
    expect(input.value).toBeNull()
    expect(input.addresses).toEqual([])
  })

  it('orders nested inputs and outputs by their indexes', () => {
    const fixture = block()
    const [row] = mapTransactions([
      {
        ...fixture,
        inputs: [
          { ...fixture.inputs[0], inputIndex: 2 },
          { ...fixture.inputs[0], inputIndex: 0 },
        ],
        outputs: [
          { ...fixture.outputs[0], outputIndex: 3 },
          { ...fixture.outputs[0], outputIndex: 1 },
        ],
      },
    ])

    expect((row['inputs'] as any[]).map((input) => input.index)).toEqual([0, 2])
    expect((row['outputs'] as any[]).map((output) => output.index)).toEqual([1, 3])
  })

  it('requests every transaction with its inputs and outputs', async () => {
    let request: unknown
    portal = await mockPortal([
      {
        statusCode: 200,
        data: [block()],
        validateRequest: (receivedRequest) => {
          request = receivedRequest
        },
      },
    ])

    await readAll(btcTransactions.createStream({ portal: portal.url, range: { from: 900_000, to: 900_000 } }))

    expect(request).toMatchObject({
      type: 'bitcoin',
      fromBlock: 900_000,
      toBlock: 900_000,
      includeAllBlocks: true,
      transactions: [{ inputs: true, outputs: true }],
    })
  })

  it('declares LIST<STRUCT> inputs/outputs columns with block_number cursor', () => {
    expect(btcTransactions.table.blockNumberColumn).toBe('block_number')
    expect((btcTransactions.table.schema['inputs'] as any).type).toBe('LIST')
    expect((btcTransactions.table.schema['outputs'] as any).element.type).toBe('STRUCT')
  })
})
