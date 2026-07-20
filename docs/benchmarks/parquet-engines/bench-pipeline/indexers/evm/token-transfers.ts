import { indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

import { type EventResponse, evmEventDecoder, evmPortalStream } from '../../../../../../packages/pipes/src/evm/index.js'
import type { ParquetTable } from '../../../../../../packages/pipes/src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import { benchLogger } from '../../logger.js'
import type { BenchIndexer, Row, StreamOptions } from '../../types.js'
import { ethereum } from './chains.js'
import { dec, sigEvent } from './shared.js'

const RANGE = { from: 21_000_000, to: 21_000_999 }

export const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
export const TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
export const TRANSFER_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

// Eight decode variants over three topic0s — the same layout set registered by gfs.
const events = {
  erc721Legacy1Topic: sigEvent('Transfer(address,address,uint256)', {
    from: p.address,
    to: p.address,
    tokenId: p.uint256,
  }),
  erc20Legacy2Topic: sigEvent('Transfer(address,address,uint256)', {
    from: indexed(p.address),
    to: p.address,
    value: p.uint256,
  }),
  erc20Transfer: sigEvent('Transfer(address,address,uint256)', {
    from: indexed(p.address),
    to: indexed(p.address),
    value: p.uint256,
  }),
  erc721Transfer: sigEvent('Transfer(address,address,uint256)', {
    from: indexed(p.address),
    to: indexed(p.address),
    tokenId: indexed(p.uint256),
  }),
  erc1155TransferSingle: sigEvent('TransferSingle(address,address,address,uint256,uint256)', {
    operator: indexed(p.address),
    from: indexed(p.address),
    to: indexed(p.address),
    id: p.uint256,
    value: p.uint256,
  }),
  erc1155TransferBatch: sigEvent('TransferBatch(address,address,address,uint256[],uint256[])', {
    operator: indexed(p.address),
    from: indexed(p.address),
    to: indexed(p.address),
    ids: p.array(p.uint256),
    values: p.array(p.uint256),
  }),
  erc1155TransferSingleLegacy0Indexed: sigEvent('TransferSingle(address,address,address,uint256,uint256)', {
    operator: p.address,
    from: p.address,
    to: p.address,
    id: p.uint256,
    value: p.uint256,
  }),
  erc1155TransferBatchLegacy0Indexed: sigEvent('TransferBatch(address,address,address,uint256[],uint256[])', {
    operator: p.address,
    from: p.address,
    to: p.address,
    ids: p.array(p.uint256),
    values: p.array(p.uint256),
  }),
}

type DecoderResponse = EventResponse<typeof events, string[]>

export type TokenTransferData = {
  [K in keyof DecoderResponse]: Omit<DecoderResponse[K][number], 'factory'>[]
}

type TokenTransferEvent = TokenTransferData[keyof TokenTransferData][number]

const table: ParquetTable = {
  table: 'token_transfers',
  blockNumberColumn: 'block_number',
  schema: {
    block_hash: { type: 'UTF8' },
    block_number: { type: 'INT64' },
    block_timestamp: { type: 'TIMESTAMP' },
    transaction_hash: { type: 'UTF8' },
    transaction_index: { type: 'INT64' },
    event_index: { type: 'INT64' },
    batch_index: { type: 'INT64', optional: true },
    address: { type: 'UTF8', optional: true },
    event_type: { type: 'UTF8' },
    event_hash: { type: 'UTF8' },
    event_signature: { type: 'UTF8' },
    operator_address: { type: 'UTF8', optional: true },
    from_address: { type: 'UTF8' },
    to_address: { type: 'UTF8' },
    token_id: { type: 'UTF8', optional: true },
    quantity: { type: 'UTF8' },
    removed: { type: 'BOOLEAN', optional: true },
  },
}

function envelope(event: TokenTransferEvent): Row {
  return {
    block_hash: event.block.hash,
    block_number: event.block.number,
    block_timestamp: event.timestamp.getTime(),
    transaction_hash: event.rawEvent.transactionHash,
    transaction_index: event.rawEvent.transactionIndex,
    event_index: event.rawEvent.logIndex,
    address: event.contract,
    removed: false,
  }
}

const TRANSFER_SIG = 'Transfer(address,address,uint256)'
const SINGLE_SIG = 'TransferSingle(address,address,address,uint256,uint256)'
const BATCH_SIG = 'TransferBatch(address,address,address,uint256[],uint256[])'

export function mapTokenTransfers(data: TokenTransferData): Row[] {
  const rows: Row[] = []

  for (const event of data.erc721Legacy1Topic ?? []) {
    rows.push({
      ...envelope(event),
      batch_index: null,
      event_type: 'ERC-721',
      event_hash: TRANSFER,
      event_signature: TRANSFER_SIG,
      operator_address: null,
      from_address: event.event.from,
      to_address: event.event.to,
      token_id: dec(event.event.tokenId),
      quantity: '1',
    })
  }

  for (const event of data.erc20Legacy2Topic ?? []) {
    rows.push({
      ...envelope(event),
      batch_index: null,
      event_type: 'ERC-20',
      event_hash: TRANSFER,
      event_signature: TRANSFER_SIG,
      operator_address: null,
      from_address: event.event.from,
      to_address: event.event.to,
      token_id: null,
      quantity: dec(event.event.value) ?? '0',
    })
  }

  for (const event of data.erc20Transfer ?? []) {
    // Four-topic logs are canonical ERC-721 events and are handled by the next loop.
    if (event.rawEvent.topics.length === 4) {
      continue
    }

    rows.push({
      ...envelope(event),
      batch_index: null,
      event_type: 'ERC-20',
      event_hash: TRANSFER,
      event_signature: TRANSFER_SIG,
      operator_address: null,
      from_address: event.event.from,
      to_address: event.event.to,
      token_id: null,
      quantity: dec(event.event.value) ?? '0',
    })
  }

  for (const event of data.erc721Transfer ?? []) {
    rows.push({
      ...envelope(event),
      batch_index: null,
      event_type: 'ERC-721',
      event_hash: TRANSFER,
      event_signature: TRANSFER_SIG,
      operator_address: null,
      from_address: event.event.from,
      to_address: event.event.to,
      token_id: dec(event.event.tokenId),
      quantity: '1',
    })
  }

  const singleEvents = [...(data.erc1155TransferSingle ?? []), ...(data.erc1155TransferSingleLegacy0Indexed ?? [])]
  for (const event of singleEvents) {
    rows.push({
      ...envelope(event),
      batch_index: null,
      event_type: 'ERC-1155',
      event_hash: TRANSFER_SINGLE,
      event_signature: SINGLE_SIG,
      operator_address: event.event.operator,
      from_address: event.event.from,
      to_address: event.event.to,
      token_id: dec(event.event.id),
      quantity: dec(event.event.value) ?? '0',
    })
  }

  const batchEvents = [...(data.erc1155TransferBatch ?? []), ...(data.erc1155TransferBatchLegacy0Indexed ?? [])]
  for (const event of batchEvents) {
    const ids = event.event.ids ?? []
    const values = event.event.values ?? []
    if (ids.length !== values.length) {
      continue
    }

    for (let index = 0; index < ids.length; index++) {
      rows.push({
        ...envelope(event),
        batch_index: index,
        event_type: 'ERC-1155',
        event_hash: TRANSFER_BATCH,
        event_signature: BATCH_SIG,
        operator_address: event.event.operator,
        from_address: event.event.from,
        to_address: event.event.to,
        token_id: dec(ids[index]),
        quantity: dec(values[index]) ?? '0',
      })
    }
  }

  return rows
}

function createStream(opts: StreamOptions = {}) {
  const range = opts.range ?? RANGE

  return evmPortalStream({
    id: 'bench-ethereum-token-transfers',
    portal: opts.portal ?? ethereum.portalUrl,
    logger: benchLogger('bench-ethereum-token-transfers'),
    cache: openCache(opts.cachePath),
    // Topic-count checks skip non-matching layouts that share topic0; retain gfs's no-op error observer.
    outputs: evmEventDecoder({ range, events, onError: () => undefined }),
  }).pipe((data) => mapTokenTransfers(data))
}

export const ethereumTokenTransfers: BenchIndexer = {
  id: 'ethereum-token-transfers',
  portalUrl: ethereum.portalUrl,
  range: RANGE,
  table,
  createStream,
}
