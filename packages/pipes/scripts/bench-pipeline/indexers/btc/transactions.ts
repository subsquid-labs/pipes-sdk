import { type BitcoinPortalData, bitcoinPortalStream, bitcoinQuery } from '../../../../src/bitcoin/index.js'
import type { ParquetColumn, ParquetTable } from '../../../../src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, Row, StreamOptions } from '../../types.js'
import { BTC_PORTAL_URL } from './blocks.js'
import { btcToSatoshiBigInt, decodeScript, timestampToMonthDate } from './shared.js'

const RANGE = { from: 900_000, to: 900_099 }

const inputStruct: ParquetColumn = {
  type: 'STRUCT',
  fields: {
    index: { type: 'INT64' },
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

const outputStruct: ParquetColumn = {
  type: 'STRUCT',
  fields: {
    index: { type: 'INT64' },
    script_asm: { type: 'UTF8', optional: true },
    script_hex: { type: 'UTF8', optional: true },
    required_signatures: { type: 'INT64', optional: true },
    type: { type: 'UTF8', optional: true },
    addresses: { type: 'LIST', element: { type: 'UTF8' } },
    value: { type: 'UTF8', optional: true },
  },
}

const table: ParquetTable = {
  table: 'transactions',
  blockNumberColumn: 'block_number',
  schema: {
    hash: { type: 'UTF8' },
    size: { type: 'INT64', optional: true },
    virtual_size: { type: 'INT64', optional: true },
    version: { type: 'INT64', optional: true },
    lock_time: { type: 'INT64', optional: true },
    block_hash: { type: 'UTF8' },
    block_number: { type: 'INT64' },
    block_timestamp: { type: 'TIMESTAMP' },
    block_timestamp_month: { type: 'DATE' },
    input_count: { type: 'INT64', optional: true },
    output_count: { type: 'INT64', optional: true },
    input_value: { type: 'UTF8', optional: true },
    output_value: { type: 'UTF8', optional: true },
    is_coinbase: { type: 'BOOLEAN', optional: true },
    fee: { type: 'UTF8', optional: true },
    inputs: { type: 'LIST', element: inputStruct },
    outputs: { type: 'LIST', element: outputStruct },
  },
}

const fields = {
  block: { number: true, hash: true, timestamp: true },
  transaction: {
    transactionIndex: true,
    txid: true,
    size: true,
    vsize: true,
    version: true,
    locktime: true,
  },
  input: {
    transactionIndex: true,
    inputIndex: true,
    type: true,
    coinbase: true,
    prevoutValue: true,
    txid: true,
    vout: true,
    scriptSigHex: true,
    scriptSigAsm: true,
    sequence: true,
    prevoutScriptPubKeyType: true,
    prevoutScriptPubKeyHex: true,
  },
  output: {
    transactionIndex: true,
    outputIndex: true,
    value: true,
    scriptPubKeyHex: true,
    scriptPubKeyAsm: true,
    scriptPubKeyType: true,
  },
} as const

type TransactionBlock = BitcoinPortalData<typeof fields>[number]

function groupByTransaction<T extends { transactionIndex: number }>(items: T[]): Map<number, T[]> {
  const byTransaction = new Map<number, T[]>()
  for (const item of items) {
    const transactionItems = byTransaction.get(item.transactionIndex)
    if (transactionItems === undefined) byTransaction.set(item.transactionIndex, [item])
    else transactionItems.push(item)
  }

  return byTransaction
}

export function mapTransactions(blocks: TransactionBlock[]): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    const header = block.header
    const inputsByTransaction = groupByTransaction(block.inputs)
    const outputsByTransaction = groupByTransaction(block.outputs)

    for (const transaction of block.transactions) {
      const transactionInputs = inputsByTransaction.get(transaction.transactionIndex) ?? []
      const transactionOutputs = outputsByTransaction.get(transaction.transactionIndex) ?? []
      const isCoinbase = transactionInputs.some((input) => input.type === 'coinbase')

      let inputValue = 0n
      const nestedInputs = transactionInputs.map((input) => {
        const prevoutSatoshi = btcToSatoshiBigInt(input.prevoutValue)
        inputValue += prevoutSatoshi
        const isCoinbaseInput = input.type === 'coinbase'
        const decoded = isCoinbaseInput
          ? { addresses: [] as string[], requiredSignatures: null as number | null }
          : decodeScript(input.prevoutScriptPubKeyHex)

        return {
          index: input.inputIndex,
          spent_transaction_hash: isCoinbaseInput ? null : (input.txid ?? null),
          spent_output_index: isCoinbaseInput ? null : (input.vout ?? null),
          script_asm: isCoinbaseInput ? null : (input.scriptSigAsm ?? null),
          script_hex: isCoinbaseInput ? (input.coinbase ?? null) : (input.scriptSigHex ?? null),
          sequence: input.sequence ?? null,
          required_signatures: decoded.requiredSignatures,
          type: isCoinbaseInput ? null : (input.prevoutScriptPubKeyType ?? null),
          addresses: decoded.addresses,
          value: isCoinbaseInput || input.prevoutValue === undefined ? null : prevoutSatoshi.toString(),
        }
      })

      let outputValue = 0n
      const nestedOutputs = transactionOutputs.map((output) => {
        const valueSatoshi = btcToSatoshiBigInt(output.value)
        outputValue += valueSatoshi
        const decoded = decodeScript(output.scriptPubKeyHex)

        return {
          index: output.outputIndex,
          script_asm: output.scriptPubKeyAsm ?? null,
          script_hex: output.scriptPubKeyHex ?? null,
          required_signatures: decoded.requiredSignatures,
          type: output.scriptPubKeyType ?? decoded.type,
          addresses: decoded.addresses,
          value: valueSatoshi.toString(),
        }
      })

      nestedInputs.sort((left, right) => left.index - right.index)
      nestedOutputs.sort((left, right) => left.index - right.index)
      const fee = isCoinbase ? 0n : inputValue - outputValue

      rows.push({
        hash: transaction.txid,
        size: transaction.size ?? null,
        virtual_size: transaction.vsize ?? null,
        version: transaction.version ?? null,
        lock_time: transaction.locktime ?? null,
        block_hash: header.hash,
        block_number: header.number,
        block_timestamp: header.timestamp * 1000,
        block_timestamp_month: timestampToMonthDate(header.timestamp),
        input_count: transactionInputs.length,
        output_count: transactionOutputs.length,
        input_value: inputValue.toString(),
        output_value: outputValue.toString(),
        is_coinbase: isCoinbase,
        fee: fee.toString(),
        inputs: nestedInputs,
        outputs: nestedOutputs,
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
    .addTransactionRequest({ range, request: { inputs: true, outputs: true } })

  return bitcoinPortalStream({
    id: 'bench-btc-transactions',
    portal: opts.portal ?? BTC_PORTAL_URL,
    logger: 'warn',
    cache: openCache(opts.cachePath),
    outputs: query,
  }).pipe(mapTransactions)
}

export const btcTransactions: BenchIndexer = {
  id: 'btc-transactions',
  portalUrl: BTC_PORTAL_URL,
  range: RANGE,
  table,
  createStream,
}
