import { QueryAwareTransformer, SetupQueryFn, Subset, parsePortalRange } from '~/core/index.js'
import { mergeDeep } from '~/internal/object/merge-deep.js'
import * as evm from '~/portal-client/query/evm.js'

import { QueryBuilder, RequestOptions, concatQueryLists } from '../core/query-builder.js'

export type { Subset } from '~/core/index.js'

export type EvmPortalData<F extends evm.FieldSelection> = evm.Block<F>[]

type EvmTransformerOut<F extends evm.FieldSelection> = QueryAwareTransformer<
  EvmPortalData<F>,
  EvmPortalData<F>,
  EvmQueryBuilder<F>
>

// biome-ignore lint/complexity/noBannedTypes: <it is a default generic constraint>
export class EvmQueryBuilder<F extends evm.FieldSelection = {}> extends QueryBuilder<F, evm.DataRequest> {
  getType() {
    return 'evm'
  }

  addFields<T extends evm.FieldSelection>(fields: Subset<T, evm.FieldSelection>): EvmQueryBuilder<F & T> {
    this.fields = mergeDeep(this.fields, fields as object)

    return this as unknown as EvmQueryBuilder<F & T>
  }

  private addRequest(type: keyof evm.DataRequest, options: RequestOptions<any>): this {
    this.requests.push({
      range: parsePortalRange(options.range),
      request: {
        [type]: [{ ...options.request }],
      },
    })
    return this
  }

  addLog(options: RequestOptions<evm.LogRequest>): this {
    return this.addRequest('logs', options)
  }

  addTransaction(options: RequestOptions<evm.TransactionRequest>): this {
    return this.addRequest('transactions', options)
  }

  addTrace(options: RequestOptions<evm.TraceRequest>): this {
    return this.addRequest('traces', options)
  }

  addStateDiff(options: RequestOptions<evm.StateDiffRequest>): this {
    return this.addRequest('stateDiffs', options)
  }

  mergeDataRequests(...requests: evm.DataRequest[]): evm.DataRequest {
    let res: evm.DataRequest = {}
    for (let req of requests) {
      res.transactions = concatQueryLists(res.transactions, req.transactions)
      res.logs = concatQueryLists(res.logs, req.logs)
      res.traces = concatQueryLists(res.traces, req.traces)
      res.stateDiffs = concatQueryLists(res.stateDiffs, req.stateDiffs)
      if (res.includeAllBlocks || req.includeAllBlocks) {
        res.includeAllBlocks = true
      }
    }
    return res
  }

  override build(opts?: { setupQuery?: SetupQueryFn<EvmQueryBuilder<F>> }): EvmTransformerOut<F> {
    const setupQuery = opts?.setupQuery ?? (({ query }) => query.merge(this))

    return new QueryAwareTransformer(setupQuery, {
      // we disable profiler to reduce noise in the metrics
      profiler: null,
      transform: (data) => data,
    })
  }
}

export function evmQuery() {
  return new EvmQueryBuilder()
}
