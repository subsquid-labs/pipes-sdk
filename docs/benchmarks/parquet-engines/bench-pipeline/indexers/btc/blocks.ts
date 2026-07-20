import {
  type BitcoinPortalData,
  bitcoinPortalStream,
  bitcoinQuery,
} from '../../../../../../packages/pipes/src/bitcoin/index.js'
import type { ParquetTable } from '../../../../../../packages/pipes/src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, Row, StreamOptions } from '../../types.js'
import { timestampToMonthDate } from './shared.js'

export const BTC_PORTAL_URL = 'https://portal.sqd.dev/datasets/bitcoin-mainnet'

const RANGE = { from: 895_000, to: 896_999 }

const table: ParquetTable = {
  table: 'blocks',
  blockNumberColumn: 'number',
  schema: {
    hash: { type: 'UTF8' },
    size: { type: 'INT64', optional: true },
    stripped_size: { type: 'INT64', optional: true },
    weight: { type: 'INT64', optional: true },
    number: { type: 'INT64' },
    version: { type: 'INT64', optional: true },
    merkle_root: { type: 'UTF8', optional: true },
    timestamp: { type: 'TIMESTAMP' },
    timestamp_month: { type: 'DATE' },
    nonce: { type: 'UTF8', optional: true },
    bits: { type: 'UTF8', optional: true },
    coinbase_param: { type: 'UTF8', optional: true },
    transaction_count: { type: 'INT64', optional: true },
  },
}

const fields = {
  block: {
    number: true,
    hash: true,
    timestamp: true,
    version: true,
    merkleRoot: true,
    nonce: true,
    bits: true,
    strippedSize: true,
    size: true,
    weight: true,
  },
  transaction: { transactionIndex: true },
  input: { transactionIndex: true, inputIndex: true, coinbase: true },
} as const

type SelectedBlock = BitcoinPortalData<typeof fields>[number]
type BtcBlock = {
  header: Omit<SelectedBlock['header'], 'nonce'> & { nonce?: SelectedBlock['header']['nonce'] | null }
  transactions?: SelectedBlock['transactions']
  inputs?: SelectedBlock['inputs']
}

export function mapBlocks(blocks: BtcBlock[]): Row[] {
  return blocks.map((block) => {
    const h = block.header
    if (h.nonce === null || h.nonce === undefined) {
      throw new Error(`block ${h.number} (${h.hash}): missing nonce`)
    }

    return {
      hash: h.hash,
      size: h.size ?? null,
      stripped_size: h.strippedSize ?? null,
      weight: h.weight ?? null,
      number: h.number,
      version: h.version ?? null,
      merkle_root: h.merkleRoot ?? null,
      timestamp: h.timestamp * 1000,
      timestamp_month: timestampToMonthDate(h.timestamp),
      nonce: h.nonce.toString(16),
      bits: h.bits ?? null,
      coinbase_param: block.inputs?.[0]?.coinbase ?? null,
      transaction_count: block.transactions?.length ?? 0,
    }
  })
}

function createStream(opts: StreamOptions = {}) {
  const range = opts.range ?? RANGE
  const query = bitcoinQuery()
    .addFields(fields)
    .includeAllBlocks(range)
    .addTransactionRequest({ range, request: {} })
    .addInputRequest({ range, request: { type: ['coinbase'] } })

  return bitcoinPortalStream({
    id: 'bench-btc-blocks',
    portal: opts.portal ?? BTC_PORTAL_URL,
    logger: 'warn',
    cache: openCache(opts.cachePath),
    outputs: query,
  }).pipe(mapBlocks)
}

export const btcBlocks: BenchIndexer = {
  id: 'btc-blocks',
  portalUrl: BTC_PORTAL_URL,
  range: RANGE,
  table,
  createStream,
}
