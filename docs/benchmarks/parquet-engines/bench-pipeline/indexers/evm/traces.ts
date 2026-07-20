import { type EvmPortalData, evmPortalStream, evmQuery } from '../../../../../../packages/pipes/src/evm/index.js'
import type { ParquetTable } from '../../../../../../packages/pipes/src/targets/parquet/index.js'
import { openCache } from '../../cache.js'
import type { BenchIndexer, Row, StreamOptions } from '../../types.js'
import { ethereum } from './chains.js'
import { dec } from './shared.js'

const RANGE = { from: 21_000_000, to: 21_000_199 }

const fields = {
  block: { number: true, hash: true, timestamp: true },
  transaction: { transactionIndex: true, hash: true },
  trace: {
    type: true,
    transactionIndex: true,
    traceAddress: true,
    subtraces: true,
    error: true,
    createFrom: true,
    createValue: true,
    createGas: true,
    createInit: true,
    createResultGasUsed: true,
    createResultCode: true,
    createResultAddress: true,
    callCallType: true,
    callFrom: true,
    callTo: true,
    callValue: true,
    callGas: true,
    callInput: true,
    callResultGasUsed: true,
    callResultOutput: true,
    suicideAddress: true,
    suicideRefundAddress: true,
    suicideBalance: true,
    rewardAuthor: true,
    rewardValue: true,
    rewardType: true,
  },
} as const

type SelectedBlock = EvmPortalData<typeof fields>[number]
type SelectedTrace = SelectedBlock['traces'][number]
type SelectedCreateTrace = Extract<SelectedTrace, { type: 'create' }>
type SelectedCallTrace = Extract<SelectedTrace, { type: 'call' }>
type SelectedSuicideTrace = Extract<SelectedTrace, { type: 'suicide' }>
type SelectedRewardTrace = Extract<SelectedTrace, { type: 'reward' }>

type EvmCreateTrace = Omit<SelectedCreateTrace, 'action' | 'result'> & {
  action?: Partial<SelectedCreateTrace['action']>
  result?: Partial<NonNullable<SelectedCreateTrace['result']>>
}
type EvmCallTrace = Omit<SelectedCallTrace, 'action' | 'result'> & {
  action?: Partial<SelectedCallTrace['action']>
  result?: Partial<NonNullable<SelectedCallTrace['result']>>
}
type EvmSuicideTrace = Omit<SelectedSuicideTrace, 'action'> & {
  action?: Partial<SelectedSuicideTrace['action']>
}
type EvmRewardTrace = Omit<SelectedRewardTrace, 'action'> & {
  action?: Partial<SelectedRewardTrace['action']>
}
type EvmTrace = EvmCreateTrace | EvmCallTrace | EvmSuicideTrace | EvmRewardTrace

type EvmTraceBlock = {
  header: SelectedBlock['header']
  transactions?: SelectedBlock['transactions']
  traces?: EvmTrace[]
}

type TraceActionRow = {
  from_address: string | null
  to_address: string | null
  call_type: string | null
  gas: bigint | null
  input: string | null
  value: string | null
  value_lossless: string | null
  init: string | null
  author: string | null
  reward_type: string | null
  refund_address: string | null
  refund_balance: string | null
  refund_balance_lossless: string | null
  self_destructed_address: string | null
}

type TraceResultRow = {
  gas_used: bigint | null
  output: string | null
  address: string | null
  code: string | null
}

const table: ParquetTable = {
  table: 'traces',
  blockNumberColumn: 'block_number',
  schema: {
    block_hash: { type: 'UTF8' },
    block_number: { type: 'INT64' },
    block_timestamp: { type: 'TIMESTAMP' },
    transaction_hash: { type: 'UTF8', optional: true },
    transaction_index: { type: 'INT64', optional: true },
    trace_type: { type: 'UTF8' },
    trace_address: { type: 'LIST', element: { type: 'INT64' } },
    subtrace_count: { type: 'INT64' },
    action: {
      type: 'STRUCT',
      fields: {
        from_address: { type: 'UTF8', optional: true },
        to_address: { type: 'UTF8', optional: true },
        call_type: { type: 'UTF8', optional: true },
        gas: { type: 'INT64', optional: true },
        input: { type: 'UTF8', optional: true },
        value: { type: 'UTF8', optional: true },
        value_lossless: { type: 'UTF8', optional: true },
        init: { type: 'UTF8', optional: true },
        author: { type: 'UTF8', optional: true },
        reward_type: { type: 'UTF8', optional: true },
        refund_address: { type: 'UTF8', optional: true },
        refund_balance: { type: 'UTF8', optional: true },
        refund_balance_lossless: { type: 'UTF8', optional: true },
        self_destructed_address: { type: 'UTF8', optional: true },
      },
    },
    result: {
      type: 'STRUCT',
      optional: true,
      fields: {
        gas_used: { type: 'INT64', optional: true },
        output: { type: 'UTF8', optional: true },
        address: { type: 'UTF8', optional: true },
        code: { type: 'UTF8', optional: true },
      },
    },
    error: { type: 'UTF8', optional: true },
  },
}

function emptyAction(): TraceActionRow {
  return {
    from_address: null,
    to_address: null,
    call_type: null,
    gas: null,
    input: null,
    value: null,
    value_lossless: null,
    init: null,
    author: null,
    reward_type: null,
    refund_address: null,
    refund_balance: null,
    refund_balance_lossless: null,
    self_destructed_address: null,
  }
}

export function mapTraces(blocks: EvmTraceBlock[]): Row[] {
  const rows: Row[] = []
  for (const block of blocks) {
    const header = block.header
    const transactionHashByIndex = new Map<number, string>()
    for (const transaction of block.transactions ?? []) {
      transactionHashByIndex.set(transaction.transactionIndex, transaction.hash)
    }

    for (const trace of block.traces ?? []) {
      const action = emptyAction()
      let result: TraceResultRow | null = null

      switch (trace.type) {
        case 'create': {
          const value = dec(trace.action?.value)
          action.from_address = trace.action?.from ?? null
          action.gas = trace.action?.gas ?? null
          action.value = value
          action.value_lossless = value
          action.init = trace.action?.init ?? null
          if (trace.result) {
            result = {
              gas_used: trace.result.gasUsed ?? null,
              address: trace.result.address ?? null,
              code: trace.result.code ?? null,
              output: null,
            }
          }

          break
        }
        case 'call': {
          const value = dec(trace.action?.value)
          action.call_type = trace.action?.callType ?? null
          action.from_address = trace.action?.from ?? null
          action.to_address = trace.action?.to ?? null
          action.gas = trace.action?.gas ?? null
          action.input = trace.action?.input ?? null
          action.value = value
          action.value_lossless = value
          if (trace.result) {
            result = {
              gas_used: trace.result.gasUsed ?? null,
              output: trace.result.output ?? null,
              address: null,
              code: null,
            }
          }

          break
        }
        case 'suicide': {
          const balance = dec(trace.action?.balance)
          action.self_destructed_address = trace.action?.address ?? null
          action.refund_address = trace.action?.refundAddress ?? null
          action.refund_balance = balance
          action.refund_balance_lossless = balance

          break
        }
        case 'reward': {
          const value = dec(trace.action?.value)
          action.author = trace.action?.author ?? null
          action.value = value
          action.value_lossless = value
          action.reward_type = trace.action?.type ?? null

          break
        }
      }

      const isReward = trace.type === 'reward'
      rows.push({
        block_hash: header.hash,
        block_number: header.number,
        block_timestamp: header.timestamp * 1000,
        transaction_hash: isReward ? null : (transactionHashByIndex.get(trace.transactionIndex) ?? null),
        transaction_index: isReward ? null : trace.transactionIndex,
        trace_type: trace.type,
        trace_address: trace.traceAddress ?? [],
        subtrace_count: trace.subtraces,
        action,
        result,
        error: trace.error ?? null,
      })
    }
  }

  return rows
}

function createStream(opts: StreamOptions = {}) {
  const range = opts.range ?? RANGE
  const query = evmQuery()
    .addFields(fields)
    .addTraceRequest({ range, request: {} })
    .addTransactionRequest({ range, request: {} })

  return evmPortalStream({
    id: 'bench-ethereum-traces',
    portal: opts.portal ?? ethereum.portalUrl,
    logger: 'warn',
    cache: openCache(opts.cachePath),
    outputs: query,
  }).pipe((blocks) => mapTraces(blocks))
}

export const ethereumTraces: BenchIndexer = {
  id: 'ethereum-traces',
  portalUrl: ethereum.portalUrl,
  range: RANGE,
  table,
  createStream,
}
