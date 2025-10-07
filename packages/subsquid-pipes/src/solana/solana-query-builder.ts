import { concatQueryLists, QueryBuilder, Range, RequestOptions } from '../core/query-builder.js'
import { solana } from '../portal-client/index.js'

export type LogRequestOptions = RequestOptions<solana.LogRequest>
export type TransactionRequestOptions = RequestOptions<solana.TransactionRequest>
export type InstructionRequestOptions = RequestOptions<solana.InstructionRequest>
export type TokenBalanceRequestOptions = RequestOptions<solana.TokenBalanceRequest>
export type BalanceRequestOptions = RequestOptions<solana.BalanceRequest>
export type RewardRequestOptions = RequestOptions<solana.RewardRequest>

export class SolanaQueryBuilder extends QueryBuilder<solana.FieldSelection, solana.DataRequest> {
  getType() {
    return 'solana'
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

  mergeDataRequests(...requests: solana.DataRequest[]): solana.DataRequest {
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
}
