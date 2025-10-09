import { parsePortalRange } from '~/core/index.js'
import { mergeDeep } from '~/internal/object/merge-deep.js'
import { concatQueryLists, QueryBuilder, RequestOptions, Subset } from '../core/query-builder.js'
import { evm } from '../portal-client/index.js'

// biome-ignore lint/complexity/noBannedTypes: <it is a default generic constraint>
export class EvmQueryBuilder<F extends evm.FieldSelection = {}> extends QueryBuilder<F, evm.DataRequest> {
  getType() {
    return 'evm'
  }

  addFields<T extends Subset<T, evm.FieldSelection>>(fields: T): EvmQueryBuilder<F & T> {
    this.fields = mergeDeep(this.fields, fields)

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
}
