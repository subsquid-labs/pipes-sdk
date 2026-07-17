import { describe, expect, it } from 'vitest'

import { ethereumReceipts, mapReceipts, polygonReceipts } from './receipts.js'

describe('evm receipts', () => {
  it('emits one row per transaction with null logs_bloom/root (portal limitation)', () => {
    const rows = mapReceipts([
      {
        header: { number: 21_000_000, hash: '0xblock', timestamp: 1_730_000_000 },
        transactions: [
          {
            transactionIndex: 2,
            hash: '0xtx',
            from: '0xfrom',
            to: '0xto',
            contractAddress: null,
            cumulativeGasUsed: 100_000n,
            gasUsed: 21_000n,
            effectiveGasPrice: 7_000_000_000n,
            status: 1,
          },
        ],
      },
    ])

    expect(rows).toEqual([
      {
        block_hash: '0xblock',
        block_number: 21_000_000,
        block_timestamp: 1_730_000_000_000,
        transaction_hash: '0xtx',
        transaction_index: 2,
        from_address: '0xfrom',
        to_address: '0xto',
        contract_address: null,
        cumulative_gas_used: 100_000n,
        gas_used: 21_000n,
        effective_gas_price: 7_000_000_000n,
        logs_bloom: null,
        root: null,
        status: 1,
      },
    ])
  })

  it('registers both chain variants', () => {
    expect(ethereumReceipts.id).toBe('ethereum-receipts')
    expect(polygonReceipts.id).toBe('polygon-receipts')
  })
})
