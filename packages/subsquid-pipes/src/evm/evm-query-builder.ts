import {
  applyRangeBound,
  concatQueryLists,
  mergeRangeRequests,
  NaturalRange,
  Range,
  RangeRequest,
} from '../core/query-builder.js'
import { mergeDeep } from '../internal/object/merge-deep.js'
import { evm, PortalClient } from '../portal-client/index.js'

/**
 * An ordered list of non-overlapping range requests
 */
export type RangeRequestList<R> = RangeRequest<R>[]

export type RequestOptions<R> = { range: NaturalRange; request: R }
export type LogRequestOptions = RequestOptions<evm.LogRequest>
export type TransactionRequestOptions = RequestOptions<evm.TransactionRequest>
export type TraceRequestOptions = RequestOptions<evm.TraceRequest>
export type StateDiffRequestOptions = RequestOptions<evm.StateDiffRequest>
export type DataRequestRange = RangeRequest<evm.DataRequest>

export class EvmQueryBuilder {
  protected requests: RangeRequest<evm.DataRequest, NaturalRange>[] = []
  protected fields: evm.FieldSelection = {}

  getType() {
    return 'evm'
  }

  merge(query?: EvmQueryBuilder) {
    if (!query) return this

    this.requests = [...query.requests, ...this.requests]
    this.addFields(query.getFields())

    return this
  }

  addFields(fields: evm.FieldSelection): this {
    this.fields = mergeDeep(this.fields, fields)
    return this
  }

  getFields() {
    return this.fields
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

  addRange(range: NaturalRange): this {
    this.requests.push({
      range,
    } as any)
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

  async calculateRanges({ portal, bound }: { bound?: Range; portal: PortalClient }): Promise<DataRequestRange[]> {
    const latest = this.requests.some((r) => r.range.from === 'latest') ? await portal.getHead() : undefined

    const ranges = mergeRangeRequests(
      this.requests.map((r) => ({
        range: r.range.from === 'latest' ? { from: latest?.number || 0 } : r.range,
        request: r.request || {},
      })),
      mergeDataRequests,
    )

    if (!ranges.length) {
      // FIXME request should be optional
      return [{ range: bound } as any]
    }

    return applyRangeBound(ranges, bound)
  }
}

export function mergeDataRequests(...requests: evm.DataRequest[]): evm.DataRequest {
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
