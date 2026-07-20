import { describe, expect, it } from 'vitest'

import { ethereum, polygon } from './chains.js'
import { ethereumTransactions, mapTransactions, polygonTransactions } from './transactions.js'

const HEADER = { number: 21_000_000, hash: '0xblock', timestamp: 1_730_000_000 }

const TX = {
  transactionIndex: 5,
  hash: '0xtx',
  nonce: 12,
  from: '0xfrom',
  to: '0xto',
  value: 10n ** 19n,
  gas: 21_000n,
  gasPrice: 7_500_000_000n,
  input: '0x',
  maxFeePerGas: 9_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  v: 27n,
  r: '0xa1', // valid hex — polygon dual-rep decimalizes r/s via BigInt()
  s: '0xb2',
  yParity: 1,
  chainId: 1,
  type: 2,
  accessList: [{ address: '0xacc', storageKeys: ['0xk1'] }],
}

const BLOCK = { header: HEADER, transactions: [TX] }

describe('evm transactions', () => {
  it('maps the ethereum shape: value + value_lossless twins, hex signature fields', () => {
    const [row] = mapTransactions([BLOCK], ethereum)

    expect(row['transaction_hash']).toBe('0xtx')
    expect(row['block_timestamp']).toBe(1_730_000_000_000)
    expect(row['nonce']).toBe(12)
    expect(row['value']).toBe('10000000000000000000')
    expect(row['value_lossless']).toBe('10000000000000000000')
    expect(row['gas_price']).toBe(7_500_000_000n)
    expect(row['r']).toBe('0xa1')
    expect(row['s']).toBe('0xb2')
    expect(row['v']).toBe('0x1b')
    expect(row['y_parity']).toBe('0x1')
    expect(row['transaction_type']).toBe(2)
    expect(row['access_list']).toEqual([{ address: '0xacc', storage_keys: ['0xk1'] }])
  })

  it('maps the polygon shape: dual-rep value/gas_price/r/s/v, decimal nonce and y_parity', () => {
    const [row] = mapTransactions([BLOCK], polygon)

    expect(row['nonce']).toBe('12')
    expect(row['value']).toEqual({
      string_value: '10000000000000000000',
      bignumeric_value: '10000000000000000000',
    })
    expect(row['gas_price']).toEqual({ string_value: '7500000000', bignumeric_value: '7500000000' })
    expect(row['r']).toEqual({ string_value: '161', bignumeric_value: '161' }) // 0xa1 = 161
    expect(row['s']).toEqual({ string_value: '178', bignumeric_value: '178' }) // 0xb2 = 178
    expect(row['v']).toEqual({ string_value: '27', bignumeric_value: '27' })
    expect(row['y_parity']).toBe('1')
    expect(row['value_lossless']).toBeUndefined()
  })

  it('declares chain-specific tables', () => {
    expect(ethereumTransactions.id).toBe('ethereum-transactions')
    expect(polygonTransactions.id).toBe('polygon-transactions')
    expect(ethereumTransactions.table.schema['value']?.type).toBe('UTF8')
    expect(polygonTransactions.table.schema['value']?.type).toBe('STRUCT')
    expect(ethereumTransactions.table.schema['value_lossless']).toBeDefined()
    expect(polygonTransactions.table.schema['value_lossless']).toBeUndefined()
  })
})
