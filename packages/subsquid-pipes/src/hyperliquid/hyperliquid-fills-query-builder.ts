import { QueryAwareTransformer, Subset, parsePortalRange } from '~/core/index.js'
import { HyperliquidFillsPortalData } from '~/hyperliquid/hyperliquid-fills-portal-source.js'
import { mergeDeep } from '~/internal/object/merge-deep.js'

import { QueryBuilder, QueryTransformerOpts, Range, RequestOptions, concatQueryLists } from '../core/query-builder.js'
import * as api from '../portal-client/query/hyperliquid-fills.js'

type HyperliquidFillsTransformerOpts<F extends api.FieldSelection, Out> = QueryTransformerOpts<
  HyperliquidFillsPortalData<F>,
  Out,
  HyperliquidFillsQueryBuilder<F>
>

type HyperliquidFillsTransformerOut<F extends api.FieldSelection, Out> = QueryAwareTransformer<
  HyperliquidFillsPortalData<F>,
  Out,
  HyperliquidFillsQueryBuilder<F>
>

// biome-ignore lint/complexity/noBannedTypes: <it is a default generic constraint>
export class HyperliquidFillsQueryBuilder<F extends api.FieldSelection = {}> extends QueryBuilder<F, api.DataRequest> {
  getType() {
    return 'hyperliquidFills'
  }

  addFields<T extends api.FieldSelection>(fields: Subset<T, api.FieldSelection>): HyperliquidFillsQueryBuilder<F & T> {
    this.fields = mergeDeep(this.fields, fields)

    return this as unknown as HyperliquidFillsQueryBuilder<F & T>
  }

  private addRequest(type: keyof api.DataRequest, options: RequestOptions<any>): this {
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

  addFill(options: RequestOptions<api.FillRequest>): this {
    return this.addRequest('fills', options)
  }

  mergeDataRequests(...requests: api.DataRequest[]): api.DataRequest {
    let res: api.DataRequest = {}
    for (let req of requests) {
      res.fills = concatQueryLists(res.fills, req.fills)
      if (res.includeAllBlocks || req.includeAllBlocks) {
        res.includeAllBlocks = true
      }
    }
    return res
  }

  override build<Out>({
    setupQuery,
    ...options
  }: HyperliquidFillsTransformerOpts<F, Out>): HyperliquidFillsTransformerOut<F, Out> {
    setupQuery = setupQuery ? setupQuery : ({ query }) => query.merge(this)

    return new QueryAwareTransformer(setupQuery, options as any)
  }
}
