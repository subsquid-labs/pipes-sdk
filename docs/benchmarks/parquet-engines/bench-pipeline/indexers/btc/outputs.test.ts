import { describe, expect, it } from 'vitest'

import { btcOutputs, mapOutputs } from './outputs.js'

const HEADER = { number: 900_000, hash: '0000block', timestamp: 1_747_749_600 }

describe('btc-outputs', () => {
  it('emits one flat row per output with the parent txid resolved', () => {
    const rows = mapOutputs([
      {
        header: HEADER,
        transactions: [{ transactionIndex: 2, txid: 'txid-2' }],
        outputs: [
          {
            transactionIndex: 2,
            outputIndex: 1,
            value: 0.5,
            scriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
            scriptPubKeyAsm: '0 751e…',
            scriptPubKeyType: 'witness_v0_keyhash',
          },
        ],
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]['transaction_hash']).toBe('txid-2')
    expect(rows[0]['block_number']).toBe(900_000)
    expect(rows[0]['index']).toBe(1)
    expect(rows[0]['value']).toBe('50000000')
    expect(rows[0]['type']).toBe('witness_v0_keyhash')
    expect(rows[0]['addresses']).toEqual(['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'])
  })

  it('skips parentless outputs instead of throwing', () => {
    const rows = mapOutputs([
      { header: HEADER, transactions: [], outputs: [{ transactionIndex: 9, outputIndex: 0, value: 1 }] },
    ])

    expect(rows).toEqual([])
  })

  it('uses block_number cursor', () => {
    expect(btcOutputs.table.blockNumberColumn).toBe('block_number')
  })
})
