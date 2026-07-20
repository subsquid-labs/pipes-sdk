import { describe, expect, it } from 'vitest'

import {
  TRANSFER,
  TRANSFER_BATCH,
  TRANSFER_SINGLE,
  ethereumTokenTransfers,
  mapTokenTransfers,
} from './token-transfers.js'

function decoded<T extends Record<string, unknown>>(eventArgs: T, logIndex = 1, topics: string[] = [TRANSFER]) {
  return {
    event: eventArgs,
    contract: '0xtoken',
    block: { number: 21_000_000, hash: '0xblock' },
    timestamp: new Date(1_730_000_000_000),
    rawEvent: {
      address: '0xtoken',
      topics,
      data: '0x',
      transactionHash: '0xtx',
      logIndex,
      transactionIndex: 4,
    },
  }
}

const EMPTY = {
  erc721Legacy1Topic: [],
  erc20Legacy2Topic: [],
  erc20Transfer: [],
  erc721Transfer: [],
  erc1155TransferSingle: [],
  erc1155TransferBatch: [],
  erc1155TransferSingleLegacy0Indexed: [],
  erc1155TransferBatchLegacy0Indexed: [],
}

describe('ethereum-token-transfers', () => {
  it('maps an ERC-20 transfer with quantity as decimal string and null token_id', () => {
    const rows = mapTokenTransfers({
      ...EMPTY,
      erc20Transfer: [decoded({ from: '0xa', to: '0xb', value: 10n ** 18n }, 1, [TRANSFER, '0x1', '0x2'])],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]['event_type']).toBe('ERC-20')
    expect(rows[0]['quantity']).toBe('1000000000000000000')
    expect(rows[0]['token_id']).toBeNull()
    expect(rows[0]['from_address']).toBe('0xa')
    expect(rows[0]['event_index']).toBe(1)
    expect(rows[0]['block_timestamp']).toBe(1_730_000_000_000)
    expect(rows[0]['removed']).toBe(false)
  })

  it('skips 4-topic logs in the erc20 loop (canonical ERC-721 handles them)', () => {
    const rows = mapTokenTransfers({
      ...EMPTY,
      erc20Transfer: [decoded({ from: '0xa', to: '0xb', value: 1n }, 1, [TRANSFER, '0x1', '0x2', '0x3'])],
    })

    expect(rows).toEqual([])
  })

  it('maps the legacy ERC-721 and ERC-20 layouts', () => {
    const rows = mapTokenTransfers({
      ...EMPTY,
      erc721Legacy1Topic: [decoded({ from: '0xlegacy-from', to: '0xlegacy-to', tokenId: 9n })],
      erc20Legacy2Topic: [decoded({ from: '0xa', to: '0xb', value: 12n }, 2, [TRANSFER, '0x1'])],
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      event_type: 'ERC-721',
      token_id: '9',
      quantity: '1',
    })
    expect(rows[1]).toMatchObject({
      event_type: 'ERC-20',
      token_id: null,
      quantity: '12',
    })
  })

  it('maps ERC-721 with quantity 1 and the token id', () => {
    const rows = mapTokenTransfers({
      ...EMPTY,
      erc721Transfer: [decoded({ from: '0xa', to: '0xb', tokenId: 55n }, 2, [TRANSFER, '0x1', '0x2', '0x37'])],
    })

    expect(rows[0]['event_type']).toBe('ERC-721')
    expect(rows[0]['token_id']).toBe('55')
    expect(rows[0]['quantity']).toBe('1')
  })

  it('fans an ERC-1155 batch into one row per id/value pair with batch_index', () => {
    const rows = mapTokenTransfers({
      ...EMPTY,
      erc1155TransferBatch: [
        decoded({ operator: '0xop', from: '0xa', to: '0xb', ids: [1n, 2n], values: [10n, 20n] }, 3),
      ],
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]['batch_index']).toBe(0)
    expect(rows[0]['token_id']).toBe('1')
    expect(rows[0]['quantity']).toBe('10')
    expect(rows[1]['batch_index']).toBe(1)
    expect(rows[1]['operator_address']).toBe('0xop')
    expect(rows[1]['event_type']).toBe('ERC-1155')
  })

  it('drops malformed batches where ids/values lengths differ', () => {
    const rows = mapTokenTransfers({
      ...EMPTY,
      erc1155TransferBatch: [decoded({ operator: '0xop', from: '0xa', to: '0xb', ids: [1n], values: [] }, 3)],
    })

    expect(rows).toEqual([])
  })

  it('maps canonical and legacy ERC-1155 single layouts', () => {
    const rows = mapTokenTransfers({
      ...EMPTY,
      erc1155TransferSingle: [
        decoded({ operator: '0xop1', from: '0xa', to: '0xb', id: 7n, value: 70n }, 4, [
          TRANSFER_SINGLE,
          '0x1',
          '0x2',
          '0x3',
        ]),
      ],
      erc1155TransferSingleLegacy0Indexed: [
        decoded({ operator: '0xop2', from: '0xc', to: '0xd', id: 8n, value: 80n }, 5, [TRANSFER_SINGLE]),
      ],
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      event_type: 'ERC-1155',
      event_hash: TRANSFER_SINGLE,
      operator_address: '0xop1',
      token_id: '7',
      quantity: '70',
    })
    expect(rows[1]).toMatchObject({
      operator_address: '0xop2',
      token_id: '8',
      quantity: '80',
    })
  })

  it('maps the legacy ERC-1155 batch layout', () => {
    const rows = mapTokenTransfers({
      ...EMPTY,
      erc1155TransferBatchLegacy0Indexed: [
        decoded({ operator: '0xop', from: '0xa', to: '0xb', ids: [3n, 4n], values: [30n, 40n] }, 6, [TRANSFER_BATCH]),
      ],
    })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ batch_index: 0, token_id: '3', quantity: '30' })
    expect(rows[1]).toMatchObject({ batch_index: 1, token_id: '4', quantity: '40' })
  })

  it('exports the exact topic constants reused by the indexer registry', () => {
    expect(TRANSFER).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')
    expect(TRANSFER_SINGLE).toBe('0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62')
    expect(TRANSFER_BATCH).toBe('0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb')
  })

  it('registers the indexer', () => {
    expect(ethereumTokenTransfers.id).toBe('ethereum-token-transfers')
    expect(ethereumTokenTransfers.table.table).toBe('token_transfers')
  })
})
