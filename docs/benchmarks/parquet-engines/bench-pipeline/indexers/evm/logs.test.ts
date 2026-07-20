import { describe, expect, it } from 'vitest'

import { ethereumLogs, mapLogs, polygonLogs } from './logs.js'

describe('evm logs', () => {
  it('emits one row per log with removed:false', () => {
    const rows = mapLogs([
      {
        header: { number: 21_000_000, hash: '0xblock', timestamp: 1_730_000_000 },
        logs: [
          {
            logIndex: 7,
            transactionIndex: 2,
            transactionHash: '0xtx',
            address: '0xAbC',
            data: '0xdata',
            topics: ['0xt0', '0xt1'],
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
        log_index: 7,
        address: '0xAbC',
        data: '0xdata',
        topics: ['0xt0', '0xt1'],
        removed: false,
      },
    ])
  })

  it('ethereum marks join keys required, polygon leaves them nullable', () => {
    expect(ethereumLogs.table.schema['transaction_hash']?.optional).toBeUndefined()
    expect(polygonLogs.table.schema['transaction_hash']?.optional).toBe(true)
  })
})
