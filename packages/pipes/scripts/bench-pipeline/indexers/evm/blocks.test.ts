import { describe, expect, it } from 'vitest'

import { ethereumBlocks, mapBlocks, polygonBlocks } from './blocks.js'
import { ethereum, polygon } from './chains.js'

const HEADER = {
  number: 21_000_000,
  hash: '0xblock',
  parentHash: '0xparent',
  timestamp: 1_730_000_000,
  transactionsRoot: '0xtr',
  receiptsRoot: '0xrr',
  stateRoot: '0xsr',
  logsBloom: '0x00',
  sha3Uncles: '0xsha3',
  extraData: '0xed',
  miner: '0xminer',
  nonce: '0x0000000000000000',
  mixHash: '0xmix',
  size: 50_000,
  gasLimit: 30_000_000n,
  gasUsed: 12_000_000n,
  difficulty: 0n,
  totalDifficulty: 58_750_003_716_598_352_816_469n,
  baseFeePerGas: 7_000_000_000n,
  uncles: [],
  withdrawalsRoot: '0xwr',
  withdrawals: [{ index: 1, validatorIndex: 100, address: '0xval', amount: 15_000_000n }],
}

const BLOCK = { header: HEADER, transactions: [{ transactionIndex: 0 }, { transactionIndex: 1 }] }

describe('evm blocks', () => {
  it('maps the ethereum shape: hex nonce, decimal difficulty, lossless withdrawals', () => {
    const [row] = mapBlocks([BLOCK], ethereum)

    expect(row['block_number']).toBe(21_000_000)
    expect(row['block_timestamp']).toBe(1_730_000_000_000)
    expect(row['transaction_count']).toBe(2)
    expect(row['nonce']).toBe('0x0000000000000000')
    expect(row['difficulty']).toBe('0')
    expect(row['total_difficulty']).toBe('58750003716598352816469')
    expect(row['sha3_uncles']).toBe('0xsha3')
    expect(row['withdrawals_root']).toBe('0xwr')
    expect(row['withdrawals']).toEqual([
      { index: 1, validator_index: 100, address: '0xval', amount: '15000000', amount_lossless: '15000000' },
    ])
    expect(row['uncles']).toBeUndefined()
  })

  it('maps the polygon shape: decimal nonce, dual-rep difficulty, uncles list, no withdrawals', () => {
    const [row] = mapBlocks([BLOCK], polygon)

    expect(row['nonce']).toBe('0')
    expect(row['difficulty']).toEqual({ string_value: '0', bignumeric_value: '0' })
    expect(row['uncles_sha3']).toBe('0xsha3')
    expect(row['uncles']).toEqual([])
    expect(row['withdrawals']).toBeUndefined()
    expect(row['sha3_uncles']).toBeUndefined()
  })

  it('declares chain-specific parquet tables', () => {
    expect(ethereumBlocks.id).toBe('ethereum-blocks')
    expect(polygonBlocks.id).toBe('polygon-blocks')
    expect(ethereumBlocks.table.schema['withdrawals']).toBeDefined()
    expect(polygonBlocks.table.schema['withdrawals']).toBeUndefined()
    expect(polygonBlocks.table.schema['difficulty']?.type).toBe('STRUCT')
    expect(ethereumBlocks.table.blockNumberColumn).toBe('block_number')
  })
})
