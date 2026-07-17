import { type EvmPortalData, evmPortalStream, evmQuery } from '../../../../src/evm/index.js'
import type { ParquetTable } from '../../../../src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, BenchRange, Row, StreamOptions } from '../../types.js'
import { type EvmChain, ethereum, polygon } from './chains.js'

const fields = {
  block: { number: true, hash: true, timestamp: true },
  transaction: {
    transactionIndex: true,
    hash: true,
    from: true,
    to: true,
    contractAddress: true,
    cumulativeGasUsed: true,
    gasUsed: true,
    effectiveGasPrice: true,
    status: true,
  },
} as const

type SelectedBlock = EvmPortalData<typeof fields>[number]
type SelectedTransaction = SelectedBlock['transactions'][number]
type ReceiptTransaction = Omit<SelectedTransaction, 'to' | 'contractAddress' | 'status'> & {
  to?: SelectedTransaction['to'] | null
  contractAddress?: SelectedTransaction['contractAddress'] | null
  status?: SelectedTransaction['status'] | null
}
type EvmReceiptBlock = {
  header: SelectedBlock['header']
  transactions?: ReceiptTransaction[]
}

function receiptsTable(chain: EvmChain): ParquetTable {
  const optional = chain.schemaShape === 'ethereum' ? undefined : true

  return {
    table: 'receipts',
    blockNumberColumn: 'block_number',
    schema: {
      block_hash: { type: 'UTF8', optional },
      block_number: { type: 'INT64' },
      block_timestamp: { type: 'TIMESTAMP', optional },
      transaction_hash: { type: 'UTF8', optional },
      transaction_index: { type: 'INT64', optional },
      from_address: { type: 'UTF8', optional },
      to_address: { type: 'UTF8', optional: true },
      contract_address: { type: 'UTF8', optional: true },
      cumulative_gas_used: { type: 'INT64', optional },
      gas_used: { type: 'INT64', optional },
      effective_gas_price: { type: 'INT64', optional },
      logs_bloom: { type: 'UTF8', optional: true },
      root: { type: 'UTF8', optional: true },
      status: { type: 'INT64', optional: true },
    },
  }
}

export function mapReceipts(blocks: EvmReceiptBlock[]): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    const header = block.header
    for (const transaction of block.transactions ?? []) {
      rows.push({
        block_hash: header.hash,
        block_number: header.number,
        block_timestamp: header.timestamp * 1000,
        transaction_hash: transaction.hash,
        transaction_index: transaction.transactionIndex,
        from_address: transaction.from,
        to_address: transaction.to ?? null,
        contract_address: transaction.contractAddress ?? null,
        cumulative_gas_used: transaction.cumulativeGasUsed,
        gas_used: transaction.gasUsed,
        effective_gas_price: transaction.effectiveGasPrice,
        logs_bloom: null,
        root: null,
        status: transaction.status ?? null,
      })
    }
  }

  return rows
}

function createIndexer(chain: EvmChain, range: BenchRange): BenchIndexer {
  const id = `${chain.id}-receipts`
  const table = receiptsTable(chain)

  return {
    id,
    portalUrl: chain.portalUrl,
    range,
    table,
    createStream(opts: StreamOptions = {}) {
      const selectedRange = opts.range ?? range
      const query = evmQuery().addFields(fields).addTransactionRequest({ range: selectedRange, request: {} })

      return evmPortalStream({
        id: `bench-${id}`,
        portal: opts.portal ?? chain.portalUrl,
        logger: 'warn',
        cache: openCache(opts.cachePath),
        outputs: query,
      }).pipe((blocks) => mapReceipts(blocks))
    },
  }
}

export const ethereumReceipts = createIndexer(ethereum, { from: 21_000_000, to: 21_000_999 })
export const polygonReceipts = createIndexer(polygon, { from: 65_000_000, to: 65_000_999 })
