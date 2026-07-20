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
  table: 'outputs',
  blockNumberColumn: 'block_number',
  schema: {
    transaction_hash: { type: 'UTF8', optional: true },
    block_hash: { type: 'UTF8', optional: true },
    block_number: { type: 'INT64' },
    block_timestamp: { type: 'TIMESTAMP', optional: true },
    index: { type: 'INT64', optional: true },
    script_asm: { type: 'UTF8', optional: true },
    script_hex: { type: 'UTF8', optional: true },
    required_signatures: { type: 'INT64', optional: true },
    type: { type: 'UTF8', optional: true },
    addresses: { type: 'LIST', element: { type: 'UTF8' } },
    value: { type: 'UTF8', optional: true },
  },
}

const fields = {
  block: { number: true, hash: true, timestamp: true },
  transaction: { transactionIndex: true, txid: true },
  output: {
    transactionIndex: true,
    outputIndex: true,
    value: true,
    scriptPubKeyHex: true,
    scriptPubKeyAsm: true,
    scriptPubKeyType: true,
  },
} as const

type SelectedOutputBlock = BitcoinPortalData<typeof fields>[number]
type SelectedOutput = SelectedOutputBlock['outputs'][number]
type Output = Pick<SelectedOutput, 'transactionIndex' | 'outputIndex'> &
  Partial<Omit<SelectedOutput, 'transactionIndex' | 'outputIndex'>>
type OutputBlock = {
  header: SelectedOutputBlock['header']
  transactions?: SelectedOutputBlock['transactions']
  outputs?: Output[]
}

export function mapOutputs(blocks: OutputBlock[]): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    const header = block.header
    const txidByIndex = new Map<number, string>()
    for (const transaction of block.transactions ?? []) {
      txidByIndex.set(transaction.transactionIndex, transaction.txid)
    }

    for (const output of block.outputs ?? []) {
      const transactionHash = txidByIndex.get(output.transactionIndex)
      if (transactionHash === undefined) continue

      const decoded = decodeScript(output.scriptPubKeyHex)
      rows.push({
        transaction_hash: transactionHash,
        block_hash: header.hash,
        block_number: header.number,
        block_timestamp: header.timestamp * 1000,
        index: output.outputIndex,
        script_asm: output.scriptPubKeyAsm ?? null,
        script_hex: output.scriptPubKeyHex ?? null,
        required_signatures: decoded.requiredSignatures,
        type: output.scriptPubKeyType ?? decoded.type,
        addresses: decoded.addresses,
        value: output.value === undefined ? null : btcToSatoshiBigInt(output.value).toString(),
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
    .addTransactionRequest({ range, request: { outputs: true } })

  return bitcoinPortalStream({
    id: 'bench-btc-outputs',
    portal: opts.portal ?? BTC_PORTAL_URL,
    logger: 'warn',
    cache: openCache(opts.cachePath),
    outputs: query,
  }).pipe(mapOutputs)
}

export const btcOutputs: BenchIndexer = {
  id: 'btc-outputs',
  portalUrl: BTC_PORTAL_URL,
  range: RANGE,
  table,
  createStream,
}
