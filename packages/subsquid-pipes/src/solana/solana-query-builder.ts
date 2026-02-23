import { QueryAwareTransformer, SetupQueryFn, Subset, parsePortalRange } from '~/core/index.js'
import { mergeDeep } from '~/internal/object/merge-deep.js'

import { QueryBuilder, Range, RequestOptions, concatQueryLists } from '../core/query-builder.js'
import * as solana from '../portal-client/query/solana.js'
import { SolanaPortalData } from './solana-portal-source.js'

type SolanaTransformerOut<F extends solana.FieldSelection> = QueryAwareTransformer<
  SolanaPortalData<F>,
  SolanaPortalData<F>,
  SolanaQueryBuilder<F>
>

// biome-ignore lint/complexity/noBannedTypes: <it is a default generic constraint>
export class SolanaQueryBuilder<F extends solana.FieldSelection = {}> extends QueryBuilder<F, solana.DataRequest> {
  getType() {
    return 'solana'
  }

  addFields<T extends solana.FieldSelection>(fields: Subset<T, solana.FieldSelection>): SolanaQueryBuilder<F & T> {
    this.fields = mergeDeep(this.fields, fields)

    return this as unknown as SolanaQueryBuilder<F & T>
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

  override build(opts?: { setupQuery?: SetupQueryFn<SolanaQueryBuilder<F>> }): SolanaTransformerOut<F> {
    const setupQuery = opts?.setupQuery ?? (({ query }) => query.merge(this))
    return new QueryAwareTransformer(setupQuery, (data) => data)
  }
}

export function solanaQuery() {
  return new SolanaQueryBuilder()
}
