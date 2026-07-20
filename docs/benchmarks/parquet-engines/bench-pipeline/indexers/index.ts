import type { BenchIndexer } from '../types.js'
import { btcBlocks } from './btc/blocks.js'
import { btcInputs } from './btc/inputs.js'
import { btcOutputs } from './btc/outputs.js'
import { btcTransactions } from './btc/transactions.js'
import { ethereumBlocks, polygonBlocks } from './evm/blocks.js'
import { ethereumEventDecoder, polygonEventDecoder } from './evm/event-decoder.js'
import { ethereumLogs, polygonLogs } from './evm/logs.js'
import { ethereumReceipts, polygonReceipts } from './evm/receipts.js'
import { ethereumTokenTransfers } from './evm/token-transfers.js'
import { ethereumTraces } from './evm/traces.js'
import { ethereumTransactions, polygonTransactions } from './evm/transactions.js'

const all: BenchIndexer[] = [
  btcBlocks,
  btcTransactions,
  btcOutputs,
  btcInputs,
  ethereumBlocks,
  ethereumTransactions,
  ethereumLogs,
  ethereumReceipts,
  ethereumTraces,
  ethereumTokenTransfers,
  ethereumEventDecoder,
  polygonBlocks,
  polygonTransactions,
  polygonLogs,
  polygonReceipts,
  polygonEventDecoder,
]

export const indexers: Record<string, BenchIndexer> = Object.fromEntries(all.map((indexer) => [indexer.id, indexer]))
