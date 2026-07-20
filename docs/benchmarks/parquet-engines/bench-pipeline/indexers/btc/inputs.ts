import {
  type BitcoinPortalData,
  bitcoinPortalStream,
  bitcoinQuery,
} from '../../../../../../packages/pipes/src/bitcoin/index.js'
import type { ParquetTable } from '../../../../../../packages/pipes/src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, Row, StreamOptions } from '../../types.js'
import { BTC_PORTAL_URL } from './blocks.js'
import { btcToSatoshiBigInt, decodeScript } from './shared.js'

const RANGE = { from: 900_000, to: 900_099 }

const table: ParquetTable = {
  table: 'inputs',
  blockNumberColumn: 'block_number',
  schema: {
    transaction_hash: { type: 'UTF8', optional: true },
    block_hash: { type: 'UTF8', optional: true },
    block_number: { type: 'INT64' },
    block_timestamp: { type: 'TIMESTAMP', optional: true },
    index: { type: 'INT64', optional: true },
    spent_transaction_hash: { type: 'UTF8', optional: true },
    spent_output_index: { type: 'INT64', optional: true },
    script_asm: { type: 'UTF8', optional: true },
    script_hex: { type: 'UTF8', optional: true },
    sequence: { type: 'INT64', optional: true },
    required_signatures: { type: 'INT64', optional: true },
    type: { type: 'UTF8', optional: true },
    addresses: { type: 'LIST', element: { type: 'UTF8' } },
    value: { type: 'UTF8', optional: true },
  },
}

const fields = {
  block: { number: true, hash: true, timestamp: true },
  transaction: { transactionIndex: true, txid: true },
  input: {
    transactionIndex: true,
    inputIndex: true,
    type: true,
    txid: true,
    vout: true,
    scriptSigHex: true,
    scriptSigAsm: true,
    sequence: true,
    coinbase: true,
    prevoutValue: true,
    prevoutScriptPubKeyType: true,
    prevoutScriptPubKeyHex: true,
  },
} as const

type SelectedInputBlock = BitcoinPortalData<typeof fields>[number]
type SelectedInput = SelectedInputBlock['inputs'][number]
type Input = Pick<SelectedInput, 'transactionIndex' | 'inputIndex' | 'type'> &
  Partial<Omit<SelectedInput, 'transactionIndex' | 'inputIndex' | 'type'>>
type InputBlock = {
  header: SelectedInputBlock['header']
  transactions?: SelectedInputBlock['transactions']
  inputs?: Input[]
}

export function mapInputs(blocks: InputBlock[]): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    const header = block.header
    const txidByIndex = new Map<number, string>()
    for (const transaction of block.transactions ?? []) {
      txidByIndex.set(transaction.transactionIndex, transaction.txid)
    }

    for (const input of block.inputs ?? []) {
      const transactionHash = txidByIndex.get(input.transactionIndex)
      if (transactionHash === undefined) continue

      const isCoinbase = input.type === 'coinbase'
      const decoded = isCoinbase
        ? { addresses: [] as string[], requiredSignatures: null as number | null }
        : decodeScript(input.prevoutScriptPubKeyHex)

      rows.push({
        transaction_hash: transactionHash,
        block_hash: header.hash,
        block_number: header.number,
        block_timestamp: header.timestamp * 1000,
        index: input.inputIndex,
        spent_transaction_hash: isCoinbase ? null : (input.txid ?? null),
        spent_output_index: isCoinbase ? null : (input.vout ?? null),
        script_asm: isCoinbase ? null : (input.scriptSigAsm ?? null),
        script_hex: isCoinbase ? (input.coinbase ?? null) : (input.scriptSigHex ?? null),
        sequence: input.sequence ?? null,
        required_signatures: decoded.requiredSignatures,
        type: isCoinbase ? null : (input.prevoutScriptPubKeyType ?? null),
        addresses: decoded.addresses,
        value:
          isCoinbase || input.prevoutValue === undefined ? null : btcToSatoshiBigInt(input.prevoutValue).toString(),
      })
    }
  }

  return rows
}

function createStream(opts: StreamOptions = {}) {
  const range = opts.range ?? RANGE
  const query = bitcoinQuery()
    .addFields(fields)
    .includeAllBlocks(range)
    .addTransactionRequest({ range, request: { inputs: true } })

  return bitcoinPortalStream({
    id: 'bench-btc-inputs',
    portal: opts.portal ?? BTC_PORTAL_URL,
    logger: 'warn',
    cache: openCache(opts.cachePath),
    outputs: query,
  }).pipe(mapInputs)
}

export const btcInputs: BenchIndexer = {
  id: 'btc-inputs',
  portalUrl: BTC_PORTAL_URL,
  range: RANGE,
  table,
  createStream,
}
