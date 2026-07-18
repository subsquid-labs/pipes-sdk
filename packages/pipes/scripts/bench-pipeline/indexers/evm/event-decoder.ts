import { type EvmPortalData, evmPortalStream, evmQuery } from '../../../../src/evm/index.js'
import type { ParquetTable } from '../../../../src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, BenchRange, Row, StreamOptions } from '../../types.js'
import { type EvmChain, ethereum, polygon } from './chains.js'
import { type EventRegistry, ethereumRegistry, polygonRegistry } from './registry.js'
import { dec, jsonStringify } from './shared.js'

const fields = {
  block: { number: true, hash: true, timestamp: true, baseFeePerGas: true },
  log: {
    address: true,
    topics: true,
    data: true,
    logIndex: true,
    transactionHash: true,
    transactionIndex: true,
  },
  transaction: {
    transactionIndex: true,
    from: true,
    to: true,
    value: true,
    gasUsed: true,
    effectiveGasPrice: true,
    type: true,
  },
} as const

type SelectedBlock = EvmPortalData<typeof fields>[number]
type SelectedLog = SelectedBlock['logs'][number]
type EventDecoderLog = Omit<SelectedLog, 'address' | 'data' | 'topics'> & {
  address?: SelectedLog['address'] | null
  data?: SelectedLog['data'] | null
  topics?: SelectedLog['topics'] | null
}
type EventDecoderHeader = Omit<SelectedBlock['header'], 'baseFeePerGas'> & {
  baseFeePerGas?: SelectedBlock['header']['baseFeePerGas'] | null
}
type EventDecoderBlock = {
  header: EventDecoderHeader
  logs?: EventDecoderLog[]
  transactions?: SelectedBlock['transactions']
}

function decodedEventsTable(chain: EvmChain): ParquetTable {
  // Polygon leaves block_timestamp/transaction_hash/transaction_index/log_index NULLABLE.
  const joinNullability = chain.schemaShape === 'ethereum' ? {} : { optional: true as const }

  return {
    table: 'decoded_events',
    blockNumberColumn: 'block_number',
    schema: {
      block_hash: { type: 'UTF8' },
      block_number: { type: 'INT64' },
      block_timestamp: { type: 'TIMESTAMP', ...joinNullability },
      transaction_hash: { type: 'UTF8', ...joinNullability },
      transaction_index: { type: 'INT64', ...joinNullability },
      log_index: { type: 'INT64', ...joinNullability },
      address: { type: 'UTF8', optional: true },
      event_hash: { type: 'UTF8', optional: true },
      event_signature: { type: 'UTF8', optional: true },
      topics: { type: 'LIST', element: { type: 'UTF8' } },
      args: { type: 'UTF8', optional: true },
      named_args: { type: 'UTF8', optional: true },
      removed: { type: 'BOOLEAN', optional: true },
      protocol: { type: 'UTF8' },
      transaction_from: { type: 'UTF8' },
      transaction_to: { type: 'UTF8' },
      transaction_value: { type: 'UTF8' },
      effective_gas_price: { type: 'UTF8' },
      gas_used: { type: 'UTF8' },
      base_fee_per_gas: { type: 'UTF8' },
      transaction_type: { type: 'INT64' },
    },
  }
}

export function mapEventDecoder(blocks: EventDecoderBlock[], registry: EventRegistry): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    const header = block.header
    const transactionByIndex = new Map(
      block.transactions?.map((transaction) => [transaction.transactionIndex, transaction]),
    )

    for (const log of block.logs ?? []) {
      const address = (log.address ?? '').toLowerCase()
      const topics = log.topics ?? []
      const decoded = registry.decodeEvent(address, topics, log.data ?? '0x')
      const protocol = registry.lookupProtocol(address) ?? decoded?.protocol ?? ''
      const transaction = transactionByIndex.get(log.transactionIndex)

      rows.push({
        block_hash: header.hash,
        block_number: header.number,
        block_timestamp: header.timestamp * 1000,
        transaction_hash: log.transactionHash,
        transaction_index: log.transactionIndex,
        log_index: log.logIndex,
        address,
        event_hash: decoded?.eventHash ?? topics[0] ?? null,
        event_signature: decoded?.signature ?? '',
        topics,
        args: decoded ? jsonStringify(Object.values(decoded.namedArgs)) : null,
        named_args: decoded ? jsonStringify(decoded.namedArgs) : null,
        removed: false,
        protocol,
        transaction_from: (transaction?.from ?? '').toLowerCase(),
        transaction_to: (transaction?.to ?? '').toLowerCase(),
        transaction_value: dec(transaction?.value) ?? '0',
        effective_gas_price: dec(transaction?.effectiveGasPrice) ?? '0',
        gas_used: dec(transaction?.gasUsed) ?? '0',
        base_fee_per_gas: dec(header.baseFeePerGas) ?? '0',
        transaction_type: transaction?.type ?? 0,
      })
    }
  }

  return rows
}

function createIndexer(chain: EvmChain, registry: EventRegistry, range: BenchRange): BenchIndexer {
  const id = `${chain.id}-event-decoder`
  const table = decodedEventsTable(chain)

  return {
    id,
    portalUrl: chain.portalUrl,
    range,
    table,
    createStream(opts: StreamOptions = {}) {
      const selectedRange = opts.range ?? range
      // Every log, unfiltered, plus the parent transaction (gfs event-decoder query).
      const query = evmQuery()
        .addFields(fields)
        .addLogRequest({
          range: selectedRange,
          request: { transaction: true },
        })

      return evmPortalStream({
        id: `bench-${id}`,
        portal: opts.portal ?? chain.portalUrl,
        logger: 'warn',
        cache: openCache(opts.cachePath),
        outputs: query,
      }).pipe((blocks) => mapEventDecoder(blocks, registry))
    },
  }
}

export const ethereumEventDecoder = createIndexer(ethereum, ethereumRegistry, {
  from: 21_000_000,
  to: 21_000_499,
})
export const polygonEventDecoder = createIndexer(polygon, polygonRegistry, { from: 65_000_000, to: 65_000_499 })
