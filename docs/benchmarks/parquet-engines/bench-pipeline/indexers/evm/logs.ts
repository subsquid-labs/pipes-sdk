import { type EvmPortalData, evmPortalStream, evmQuery } from '../../../../../../packages/pipes/src/evm/index.js'
import type { ParquetTable } from '../../../../../../packages/pipes/src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, BenchRange, Row, StreamOptions } from '../../types.js'
import { type EvmChain, ethereum, polygon } from './chains.js'

const fields = {
  block: { number: true, hash: true, timestamp: true },
  log: {
    logIndex: true,
    transactionIndex: true,
    transactionHash: true,
    address: true,
    data: true,
    topics: true,
  },
} as const

type SelectedBlock = EvmPortalData<typeof fields>[number]
type SelectedLog = SelectedBlock['logs'][number]
type EvmLogBlock = {
  header: SelectedBlock['header']
  logs?: Array<Omit<SelectedLog, 'topics'> & { topics?: SelectedLog['topics'] | null }>
}

function logsTable(chain: EvmChain): ParquetTable {
  // Polygon's schema.json leaves the join keys NULLABLE; ethereum marks them REQUIRED.
  const optional = chain.schemaShape === 'ethereum' ? undefined : true

  return {
    table: 'logs',
    blockNumberColumn: 'block_number',
    schema: {
      block_hash: { type: 'UTF8' },
      block_number: { type: 'INT64' },
      block_timestamp: { type: 'TIMESTAMP', optional },
      transaction_hash: { type: 'UTF8', optional },
      transaction_index: { type: 'INT64', optional },
      log_index: { type: 'INT64', optional },
      address: { type: 'UTF8', optional: true },
      data: { type: 'UTF8', optional: true },
      topics: { type: 'LIST', element: { type: 'UTF8' } },
      removed: { type: 'BOOLEAN', optional: true },
    },
  }
}

export function mapLogs(blocks: EvmLogBlock[]): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    const header = block.header
    for (const log of block.logs ?? []) {
      rows.push({
        block_hash: header.hash,
        block_number: header.number,
        block_timestamp: header.timestamp * 1000,
        transaction_hash: log.transactionHash,
        transaction_index: log.transactionIndex,
        log_index: log.logIndex,
        address: log.address,
        data: log.data,
        topics: log.topics ?? [],
        removed: false,
      })
    }
  }

  return rows
}

function createIndexer(chain: EvmChain, range: BenchRange): BenchIndexer {
  const id = `${chain.id}-logs`
  const table = logsTable(chain)

  return {
    id,
    portalUrl: chain.portalUrl,
    range,
    table,
    createStream(opts: StreamOptions = {}) {
      const selectedRange = opts.range ?? range
      const query = evmQuery().addFields(fields).addLogRequest({ range: selectedRange, request: {} })

      return evmPortalStream({
        id: `bench-${id}`,
        portal: opts.portal ?? chain.portalUrl,
        logger: 'warn',
        cache: openCache(opts.cachePath),
        outputs: query,
      }).pipe((blocks) => mapLogs(blocks))
    },
  }
}

export const ethereumLogs = createIndexer(ethereum, { from: 21_000_000, to: 21_000_499 })
export const polygonLogs = createIndexer(polygon, { from: 65_000_000, to: 65_000_499 })
