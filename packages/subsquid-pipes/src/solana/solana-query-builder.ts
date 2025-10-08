import { parsePortalRange } from '~/core/index.js'
import { concatQueryLists, QueryBuilder, Range, RequestOptions } from '../core/query-builder.js'
import { solana } from '../portal-client/index.js'

export class SolanaQueryBuilder extends QueryBuilder<solana.FieldSelection, solana.DataRequest> {
  getType() {
    return 'solana'
  }

  private addRequest(type: keyof solana.DataRequest, options: RequestOptions<any>): this {
    this.requests.push({
      range: parsePortalRange(options.range),
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

  addLog(options: RequestOptions<solana.LogRequest>): this {
    return this.addRequest('logs', options)
  }

  addTransaction(options: RequestOptions<solana.TransactionRequest>): this {
    return this.addRequest('transactions', options)
  }

  addReward(options: RequestOptions<solana.RewardRequest>): this {
    return this.addRequest('rewards', options)
  }

  addBalance(options: RequestOptions<solana.BalanceRequest>): this {
    return this.addRequest('balances', options)
  }

  addTokenBalance(options: RequestOptions<solana.TokenBalanceRequest>): this {
    return this.addRequest('tokenBalances', options)
  }

  addInstruction(options: RequestOptions<solana.InstructionRequest>): this {
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
