import { parsePortalRange } from '~/core/index.js'
import { mergeDeep } from '~/internal/object/merge-deep.js'

import { QueryBuilder, Range, RequestOptions, Subset, concatQueryLists } from '../core/query-builder.js'
import { substrate } from '../portal-client/index.js'

// biome-ignore lint/complexity/noBannedTypes: <it is a default generic constraint>
export class SubstrateQueryBuilder<F extends substrate.FieldSelection = {}> extends QueryBuilder<
  F,
  substrate.DataRequest
> {
  getType() {
    return 'substrate'
  }

  addFields<T extends Subset<T, substrate.FieldSelection>>(fields: T): SubstrateQueryBuilder<F & T> {
    this.fields = mergeDeep(this.fields, fields)

    return this as unknown as SubstrateQueryBuilder<F & T>
  }

  private addRequest(type: keyof substrate.DataRequest, options: RequestOptions<any>): this {
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

  addEvent(options: RequestOptions<substrate.EventRequest>): this {
    return this.addRequest('events', options)
  }

  addCall(options: RequestOptions<substrate.CallRequest>): this {
    return this.addRequest('calls', options)
  }

  addEvmLog(options: RequestOptions<substrate.EvmLogRequest>): this {
    return this.addRequest('evmLogs', options)
  }

  addEthereumTransaction(options: RequestOptions<substrate.EthereumTransactRequest>): this {
    return this.addRequest('ethereumTransactions', options)
  }

  addContractsEvent(options: RequestOptions<substrate.ContractsContractEmittedRequest>): this {
    return this.addRequest('contractsEvents', options)
  }

  addGearMessageQueued(options: RequestOptions<substrate.GearMessageQueuedRequest>): this {
    return this.addRequest('gearMessagesQueued', options)
  }

  addGearUserMessageSent(options: RequestOptions<substrate.GearUserMessageSentRequest>): this {
    return this.addRequest('gearUserMessagesSent', options)
  }

  mergeDataRequests(...requests: substrate.DataRequest[]): substrate.DataRequest {
    let res: substrate.DataRequest = {}
    for (let req of requests) {
      res.events = concatQueryLists(res.events, req.events)
      res.calls = concatQueryLists(res.calls, req.calls)
      res.evmLogs = concatQueryLists(res.evmLogs, req.evmLogs)
      res.ethereumTransactions = concatQueryLists(res.ethereumTransactions, req.ethereumTransactions)
      res.contractsEvents = concatQueryLists(res.contractsEvents, req.contractsEvents)
      res.gearMessagesQueued = concatQueryLists(res.gearMessagesQueued, req.gearMessagesQueued)
      res.gearUserMessagesSent = concatQueryLists(res.gearUserMessagesSent, req.gearUserMessagesSent)
      if (res.includeAllBlocks || req.includeAllBlocks) {
        res.includeAllBlocks = true
      }
    }
    return res
  }
}
