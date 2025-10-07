import { concatQueryLists, QueryBuilder, RequestOptions } from '../core/query-builder.js'
import { evm } from '../portal-client/index.js'

/**
 * An ordered list of non-overlapping range requests
 */

export type LogRequestOptions = RequestOptions<evm.LogRequest>
export type TransactionRequestOptions = RequestOptions<evm.TransactionRequest>
export type TraceRequestOptions = RequestOptions<evm.TraceRequest>
export type StateDiffRequestOptions = RequestOptions<evm.StateDiffRequest>

export class EvmQueryBuilder extends QueryBuilder<evm.FieldSelection, evm.DataRequest> {
  getType() {
    return 'evm'
  }

  private addRequest(type: keyof evm.DataRequest, options: RequestOptions<any>): this {
    this.requests.push({
      range: options.range,
      request: {
        [type]: [{ ...options.request }],
      },
    })
    return this
  }

  addLog(options: LogRequestOptions): this {
    return this.addRequest('logs', options)
  }

  addTransaction(options: TransactionRequestOptions): this {
    return this.addRequest('transactions', options)
  }

  addTrace(options: TraceRequestOptions): this {
    return this.addRequest('traces', options)
  }

  addStateDiff(options: StateDiffRequestOptions): this {
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
}
