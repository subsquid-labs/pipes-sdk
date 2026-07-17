import { describe, expect, it } from 'vitest'

import { btcInputs, mapInputs } from './inputs.js'

const HEADER = { number: 900_000, hash: '0000block', timestamp: 1_747_749_600 }

describe('btc-inputs', () => {
  it('emits one flat row per input with prevout satoshi value as a decimal string', () => {
    const rows = mapInputs([
      {
        header: HEADER,
        transactions: [{ transactionIndex: 1, txid: 'txid-1' }],
        inputs: [
          {
            transactionIndex: 1,
            inputIndex: 0,
            type: 'witness_v0_keyhash',
            prevoutValue: 0.001,
            txid: 'prev-txid',
            vout: 3,
            scriptSigHex: 'aa',
            scriptSigAsm: 'asm',
            sequence: 4294967293,
            prevoutScriptPubKeyType: 'witness_v0_keyhash',
            prevoutScriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
          },
        ],
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]['transaction_hash']).toBe('txid-1')
    expect(rows[0]['spent_transaction_hash']).toBe('prev-txid')
    expect(rows[0]['spent_output_index']).toBe(3)
    expect(rows[0]['value']).toBe('100000')
    expect(rows[0]['type']).toBe('witness_v0_keyhash')
  })

  it('nulls prevout fields for coinbase inputs and carries the coinbase hex as script_hex', () => {
    const rows = mapInputs([
      {
        header: HEADER,
        transactions: [{ transactionIndex: 0, txid: 'cb-txid' }],
        inputs: [{ transactionIndex: 0, inputIndex: 0, type: 'coinbase', coinbase: '03abcd', sequence: 0 }],
      },
    ])

    expect(rows[0]['spent_transaction_hash']).toBeNull()
    expect(rows[0]['script_hex']).toBe('03abcd')
    expect(rows[0]['type']).toBeNull()
    expect(rows[0]['value']).toBeNull()
  })

  it('skips parentless inputs instead of throwing', () => {
    const rows = mapInputs([
      { header: HEADER, transactions: [], inputs: [{ transactionIndex: 9, inputIndex: 0, type: 'x' }] },
    ])

    expect(rows).toEqual([])
  })
})
