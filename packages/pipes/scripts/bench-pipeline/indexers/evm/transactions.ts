import { type EvmPortalData, evmPortalStream, evmQuery } from '../../../../src/evm/index.js'
import type { ParquetColumns, ParquetTable } from '../../../../src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, BenchRange, Row, StreamOptions } from '../../types.js'
import { type EvmChain, ethereum, polygon } from './chains.js'
import { bigintToHex, dec, dualRep, dualRepColumn } from './shared.js'

const fields = {
  block: { number: true, hash: true, timestamp: true },
  transaction: {
    transactionIndex: true,
    hash: true,
    nonce: true,
    from: true,
    to: true,
    value: true,
    gas: true,
    gasPrice: true,
    input: true,
    maxFeePerGas: true,
    maxPriorityFeePerGas: true,
    v: true,
    r: true,
    s: true,
    yParity: true,
    chainId: true,
    type: true,
    accessList: true,
  },
} as const

type SelectedBlock = EvmPortalData<typeof fields>[number]
type SelectedTransaction = SelectedBlock['transactions'][number]
type EvmTransaction = Omit<SelectedTransaction, 'nonce'> & {
  nonce: SelectedTransaction['nonce'] | number
}
type EvmTransactionBlock = {
  header: SelectedBlock['header']
  transactions?: EvmTransaction[]
}

function transactionsTable(chain: EvmChain): ParquetTable {
  const schema: ParquetColumns = {
    block_hash: { type: 'UTF8' },
    block_number: { type: 'INT64' },
    block_timestamp: { type: 'TIMESTAMP' },
    transaction_hash: { type: 'UTF8' },
    transaction_index: { type: 'INT64' },
    from_address: { type: 'UTF8' },
    to_address: { type: 'UTF8', optional: true },
    gas: { type: 'INT64' },
    input: { type: 'UTF8' },
    max_fee_per_gas: { type: 'INT64', optional: true },
    max_priority_fee_per_gas: { type: 'INT64', optional: true },
    transaction_type: { type: 'INT64' },
    chain_id: { type: 'INT64', optional: true },
    access_list: {
      type: 'LIST',
      element: {
        type: 'STRUCT',
        fields: {
          address: { type: 'UTF8', optional: true },
          storage_keys: { type: 'LIST', element: { type: 'UTF8' } },
        },
      },
    },
    y_parity: { type: 'UTF8', optional: true },
  }

  if (chain.schemaShape === 'ethereum') {
    schema['nonce'] = { type: 'INT64' }
    schema['value'] = { type: 'UTF8' }
    schema['value_lossless'] = { type: 'UTF8' }
    schema['gas_price'] = { type: 'INT64', optional: true }
    schema['r'] = { type: 'UTF8', optional: true }
    schema['s'] = { type: 'UTF8', optional: true }
    schema['v'] = { type: 'UTF8', optional: true }
  } else {
    schema['nonce'] = { type: 'UTF8', optional: true }
    schema['value'] = dualRepColumn()
    schema['gas_price'] = dualRepColumn()
    schema['r'] = dualRepColumn()
    schema['s'] = dualRepColumn()
    schema['v'] = dualRepColumn()
  }

  return { table: 'transactions', blockNumberColumn: 'block_number', schema }
}

export function mapTransactions(blocks: EvmTransactionBlock[], chain: EvmChain): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    const header = block.header
    for (const transaction of block.transactions ?? []) {
      const row: Row = {
        block_hash: header.hash,
        block_number: header.number,
        block_timestamp: header.timestamp * 1000,
        transaction_hash: transaction.hash,
        transaction_index: transaction.transactionIndex,
        from_address: transaction.from,
        to_address: transaction.to ?? null,
        gas: transaction.gas,
        input: transaction.input,
        max_fee_per_gas: transaction.maxFeePerGas ?? null,
        max_priority_fee_per_gas: transaction.maxPriorityFeePerGas ?? null,
        transaction_type: transaction.type,
        chain_id: transaction.chainId ?? null,
        access_list: (transaction.accessList ?? []).map((entry) => ({
          address: entry.address ?? null,
          storage_keys: entry.storageKeys ?? [],
        })),
      }

      if (chain.schemaShape === 'ethereum') {
        const value = dec(transaction.value) ?? '0'
        row['nonce'] = transaction.nonce
        row['value'] = value
        row['value_lossless'] = value
        row['gas_price'] = transaction.gasPrice ?? null
        row['r'] = transaction.r ?? null
        row['s'] = transaction.s ?? null
        row['v'] = bigintToHex(transaction.v)
        row['y_parity'] =
          transaction.yParity === null || transaction.yParity === undefined
            ? null
            : `0x${Number(transaction.yParity).toString(16)}`
      } else {
        row['nonce'] = dec(transaction.nonce)
        row['value'] = dualRep(transaction.value)
        row['gas_price'] = dualRep(transaction.gasPrice)
        row['r'] = transaction.r === null || transaction.r === undefined ? null : dualRep(BigInt(transaction.r))
        row['s'] = transaction.s === null || transaction.s === undefined ? null : dualRep(BigInt(transaction.s))
        row['v'] = dualRep(transaction.v)
        row['y_parity'] =
          transaction.yParity === null || transaction.yParity === undefined ? null : String(transaction.yParity)
      }

      rows.push(row)
    }
  }

  return rows
}

function createIndexer(chain: EvmChain, range: BenchRange): BenchIndexer {
  const id = `${chain.id}-transactions`
  const table = transactionsTable(chain)

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
      }).pipe((blocks) => mapTransactions(blocks, chain))
    },
  }
}

export const ethereumTransactions = createIndexer(ethereum, { from: 21_000_000, to: 21_000_999 })
export const polygonTransactions = createIndexer(polygon, { from: 65_000_000, to: 65_000_999 })
