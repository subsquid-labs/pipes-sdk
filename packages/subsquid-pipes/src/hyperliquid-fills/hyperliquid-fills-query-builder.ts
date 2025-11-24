import { parsePortalRange } from '~/core/index.js'
import { mergeDeep } from '~/internal/object/merge-deep.js'
import { concatQueryLists, QueryBuilder, Range, RequestOptions, Subset } from '../core/query-builder.js'
import { hyperliquidFills } from '../portal-client/index.js'

// biome-ignore lint/complexity/noBannedTypes: <it is a default generic constraint>
export class HyperliquidFillsQueryBuilder<F extends hyperliquidFills.FieldSelection = {}> extends QueryBuilder<
  F,
  hyperliquidFills.DataRequest
> {
  getType() {
    return 'hyperliquidFills'
  }

  addFields<T extends Subset<T, hyperliquidFills.FieldSelection>>(fields: T): HyperliquidFillsQueryBuilder<F & T> {
    this.fields = mergeDeep(this.fields, fields)

    return this as unknown as HyperliquidFillsQueryBuilder<F & T>
  }

  private addRequest(type: keyof hyperliquidFills.DataRequest, options: RequestOptions<any>): this {
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

  addFill(options: RequestOptions<hyperliquidFills.FillRequest>): this {
    return this.addRequest('fills', options)
  }

  mergeDataRequests(...requests: hyperliquidFills.DataRequest[]): hyperliquidFills.DataRequest {
    let res: hyperliquidFills.DataRequest = {}
    for (let req of requests) {
      res.fills = concatQueryLists(res.fills, req.fills)
      if (res.includeAllBlocks || req.includeAllBlocks) {
        res.includeAllBlocks = true
      }
    }
    return res
  }
}
