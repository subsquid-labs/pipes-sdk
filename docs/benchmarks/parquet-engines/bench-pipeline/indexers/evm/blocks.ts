import { type EvmPortalData, evmPortalStream, evmQuery } from '../../../../../../packages/pipes/src/evm/index.js'
import type { ParquetColumns, ParquetTable } from '../../../../../../packages/pipes/src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, BenchRange, Row, StreamOptions } from '../../types.js'
import { type EvmChain, ethereum, polygon } from './chains.js'
import { dec, dualRep, dualRepColumn, includeAllBlocks } from './shared.js'

const fields = {
  block: {
    number: true,
    hash: true,
    parentHash: true,
    timestamp: true,
    transactionsRoot: true,
    receiptsRoot: true,
    stateRoot: true,
    logsBloom: true,
    sha3Uncles: true,
    extraData: true,
    miner: true,
    nonce: true,
    mixHash: true,
    size: true,
    gasLimit: true,
    gasUsed: true,
    difficulty: true,
    totalDifficulty: true,
    baseFeePerGas: true,
    uncles: true,
    withdrawalsRoot: true,
    withdrawals: true,
  },
  transaction: { transactionIndex: true },
} as const

type SelectedBlock = EvmPortalData<typeof fields>[number]
type SelectedWithdrawal = NonNullable<SelectedBlock['header']['withdrawals']>[number]
type EvmBlock = {
  header: Omit<SelectedBlock['header'], 'withdrawals'> & {
    withdrawals?: Array<
      Omit<SelectedWithdrawal, 'index' | 'validatorIndex'> & {
        index: SelectedWithdrawal['index'] | number
        validatorIndex: SelectedWithdrawal['validatorIndex'] | number
      }
    >
  }
  transactions?: SelectedBlock['transactions']
}

function blocksTable(chain: EvmChain): ParquetTable {
  const schema: ParquetColumns = {
    block_hash: { type: 'UTF8' },
    block_number: { type: 'INT64' },
    block_timestamp: { type: 'TIMESTAMP' },
    parent_hash: { type: 'UTF8' },
    size: { type: 'INT64' },
    extra_data: { type: 'UTF8' },
    gas_limit: { type: 'INT64' },
    gas_used: { type: 'INT64' },
    base_fee_per_gas: { type: 'INT64', optional: true },
    mix_hash: { type: 'UTF8' },
    miner: { type: 'UTF8' },
    transaction_count: { type: 'INT64' },
    transactions_root: { type: 'UTF8' },
    receipts_root: { type: 'UTF8' },
    state_root: { type: 'UTF8' },
    logs_bloom: { type: 'UTF8' },
  }

  if (chain.schemaShape === 'ethereum') {
    schema['nonce'] = { type: 'UTF8' }
    schema['difficulty'] = { type: 'UTF8', optional: true }
    schema['total_difficulty'] = { type: 'UTF8', optional: true }
    schema['sha3_uncles'] = { type: 'UTF8' }
  } else {
    schema['nonce'] = { type: 'UTF8', optional: true }
    schema['difficulty'] = dualRepColumn()
    schema['total_difficulty'] = dualRepColumn()
    schema['uncles_sha3'] = { type: 'UTF8', optional: true }
  }

  if (chain.features.uncles) {
    schema['uncles'] = { type: 'LIST', element: { type: 'UTF8' } }
  }

  if (chain.features.withdrawals) {
    schema['withdrawals_root'] = { type: 'UTF8', optional: true }
    schema['withdrawals'] = {
      type: 'LIST',
      element: {
        type: 'STRUCT',
        fields: {
          index: { type: 'INT64' },
          validator_index: { type: 'INT64' },
          address: { type: 'UTF8' },
          amount: { type: 'UTF8' },
          amount_lossless: { type: 'UTF8' },
        },
      },
    }
  }

  return { table: 'blocks', blockNumberColumn: 'block_number', schema }
}

export function mapBlocks(blocks: EvmBlock[], chain: EvmChain): Row[] {
  return blocks.map((block) => {
    const h = block.header
    const row: Row = {
      block_hash: h.hash,
      block_number: h.number,
      block_timestamp: h.timestamp * 1000,
      parent_hash: h.parentHash,
      size: h.size,
      extra_data: h.extraData,
      gas_limit: h.gasLimit,
      gas_used: h.gasUsed,
      base_fee_per_gas: h.baseFeePerGas ?? null,
      mix_hash: h.mixHash,
      miner: h.miner,
      transaction_count: block.transactions?.length ?? 0,
      transactions_root: h.transactionsRoot,
      receipts_root: h.receiptsRoot,
      state_root: h.stateRoot,
      logs_bloom: h.logsBloom,
    }

    if (chain.schemaShape === 'ethereum') {
      row['nonce'] = h.nonce
      row['difficulty'] = dec(h.difficulty)
      row['total_difficulty'] = dec(h.totalDifficulty)
      row['sha3_uncles'] = h.sha3Uncles
    } else {
      row['nonce'] = h.nonce === null || h.nonce === undefined ? null : BigInt(h.nonce).toString()
      row['difficulty'] = dualRep(h.difficulty)
      row['total_difficulty'] = dualRep(h.totalDifficulty)
      row['uncles_sha3'] = h.sha3Uncles
    }

    if (chain.features.uncles) {
      row['uncles'] = h.uncles ?? []
    }

    if (chain.features.withdrawals) {
      row['withdrawals_root'] = h.withdrawalsRoot ?? null
      row['withdrawals'] = (h.withdrawals ?? []).map((withdrawal) => {
        const amount = dec(withdrawal.amount) ?? '0'

        return {
          index: withdrawal.index,
          validator_index: withdrawal.validatorIndex,
          address: withdrawal.address,
          amount,
          amount_lossless: amount,
        }
      })
    }

    return row
  })
}

function createIndexer(chain: EvmChain, range: BenchRange): BenchIndexer {
  const id = `${chain.id}-blocks`
  const table = blocksTable(chain)

  return {
    id,
    portalUrl: chain.portalUrl,
    range,
    table,
    createStream(opts: StreamOptions = {}) {
      const selectedRange = opts.range ?? range
      const query = evmQuery().addFields(fields).addTransactionRequest({ range: selectedRange, request: {} })
      includeAllBlocks(query, selectedRange)

      return evmPortalStream({
        id: `bench-${id}`,
        portal: opts.portal ?? chain.portalUrl,
        logger: 'warn',
        cache: openCache(opts.cachePath),
        outputs: query,
      }).pipe((blocks) => mapBlocks(blocks, chain))
    },
  }
}

export const ethereumBlocks = createIndexer(ethereum, { from: 21_000_000, to: 21_004_999 })
export const polygonBlocks = createIndexer(polygon, { from: 65_000_000, to: 65_004_999 })
