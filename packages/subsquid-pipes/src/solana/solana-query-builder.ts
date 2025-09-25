import { applyRangeBound, concatQueryLists, mergeRangeRequests, Range, RangeRequest } from '../core/query-builder'
import { mergeDeep } from '../internal/object/merge-deep'
import { PortalClient, solana } from '../portal-client'

export type RequestOptions<R> = { range?: Range; request: R }
export type LogRequestOptions = RequestOptions<solana.LogRequest>
export type TransactionRequestOptions = RequestOptions<solana.TransactionRequest>
export type InstructionRequestOptions = RequestOptions<solana.InstructionRequest>
export type TokenBalanceRequestOptions = RequestOptions<solana.TokenBalanceRequest>
export type BalanceRequestOptions = RequestOptions<solana.BalanceRequest>
export type RewardRequestOptions = RequestOptions<solana.RewardRequest>

export type SolanaDataRequest = solana.DataRequest

export type DataRequestRange = RangeRequest<SolanaDataRequest>

export class SolanaQueryBuilder {
  private requests: RangeRequest<SolanaDataRequest>[] = []
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
      range: options.range ?? { from: 0 },
      request: {
        [type]: [...options.request],
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

  addRange(range: Range): this {
    this.requests.push({
      range,
    } as any)
    return this
  }

  async calculateRanges({
    portal,
    bound = { from: 0 },
  }: {
    bound: Range
    portal: PortalClient
  }): Promise<DataRequestRange[]> {
    const ranges = mergeRangeRequests(this.requests, mergeDataRequests)
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
