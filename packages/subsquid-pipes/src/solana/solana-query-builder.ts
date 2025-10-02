import { applyRangeBound, concatQueryLists, mergeRangeRequests, NaturalRange, Range } from '../core/query-builder.js'
import { mergeDeep } from '../internal/object/merge-deep.js'
import { PortalClient, solana } from '../portal-client/index.js'

export type RequestOptions<R> = { range: NaturalRange; request: R }
export type LogRequestOptions = RequestOptions<solana.LogRequest>
export type TransactionRequestOptions = RequestOptions<solana.TransactionRequest>
export type InstructionRequestOptions = RequestOptions<solana.InstructionRequest>
export type TokenBalanceRequestOptions = RequestOptions<solana.TokenBalanceRequest>
export type BalanceRequestOptions = RequestOptions<solana.BalanceRequest>
export type RewardRequestOptions = RequestOptions<solana.RewardRequest>

export type DataRequestRange = RangeRequest<solana.DataRequest>

export interface RangeRequest<Req, R = Range> {
  range: R
  request: Req
}

export class SolanaQueryBuilder {
  protected requests: RangeRequest<solana.DataRequest, NaturalRange>[] = []
  protected fields: solana.FieldSelection = {}

  getType() {
    return 'solana'
  }

  merge(query?: SolanaQueryBuilder) {
    if (!query) return this

    this.requests = [...this.requests, ...query.requests]
    this.addFields(query.getFields())

    return this
  }

  addFields(fields: solana.FieldSelection): this {
    this.fields = mergeDeep(this.fields, fields)
    return this
  }

  getFields() {
    return this.fields
  }

  private addRequest(type: keyof solana.DataRequest, options: RequestOptions<any>): this {
    this.requests.push({
      range: options.range,
      request: {
        [type]: [{ ...options.request }],
      },
    })
    return this
  }

  includeAllBlocks(range?: Range): this {
    this.requests.push({ range: range ?? { from: 0 }, request: { includeAllBlocks: true } })
    return this
  }

  addLog(options: LogRequestOptions): this {
    return this.addRequest('logs', options)
  }

  addTransaction(options: TransactionRequestOptions): this {
    return this.addRequest('transactions', options)
  }

  addReward(options: RewardRequestOptions): this {
    return this.addRequest('rewards', options)
  }

  addBalance(options: BalanceRequestOptions): this {
    return this.addRequest('balances', options)
  }

  addTokenBalance(options: TokenBalanceRequestOptions): this {
    return this.addRequest('tokenBalances', options)
  }

  addInstruction(options: InstructionRequestOptions): this {
    return this.addRequest('instructions', options)
  }

  addRange(range: NaturalRange): this {
    this.requests.push({ range } as any)
    return this
  }

  async calculateRanges({
    portal,
    bound = { from: 0 },
  }: {
    bound: Range
    portal: PortalClient
  }): Promise<DataRequestRange[]> {
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

export function mergeDataRequests(...requests: solana.DataRequest[]): solana.DataRequest {
  let res: solana.DataRequest = {}
  for (let req of requests) {
    res.transactions = concatQueryLists(res.transactions, req.transactions)
    res.logs = concatQueryLists(res.logs, req.logs)
    res.balances = concatQueryLists(res.balances, req.balances)
    res.tokenBalances = concatQueryLists(res.tokenBalances, req.tokenBalances)
    res.rewards = concatQueryLists(res.rewards, req.rewards)
    res.instructions = concatQueryLists(res.instructions, req.instructions)
    if (res.includeAllBlocks || req.includeAllBlocks) {
      res.includeAllBlocks = true
    }
  }
  return res
}
