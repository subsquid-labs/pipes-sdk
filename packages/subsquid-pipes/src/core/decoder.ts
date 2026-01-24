import { PortalClient } from '~/portal-client/client.js'

import { Logger } from './logger.js'
import { Transformer, TransformerOptions } from './transformer.js'

export type QueryCtx<Query> = {
  queryBuilder: Query
  portal: PortalClient
  logger: Logger
}

type DecoderExtension<Query> = {
  query: (ctx: QueryCtx<Query>) => void | Promise<void>
}

export type DecoderOptions<In, Out, Query> = TransformerOptions<In, Out> & DecoderExtension<Query>

export class Decoder<In, Out, Query> extends Transformer<In, Out> {
  constructor(override options: DecoderOptions<In, Out, Query>) {
    super(options)
  }

  /**
   * @internal
   */
  async query(ctx: QueryCtx<Query>) {
    await this.options.query(ctx)
  }

  /**
   * We need to override the return type
   */
  override pipe<Res>(
    transformer: Transformer<Out, Res> | TransformerOptions<Out, Res> | TransformerOptions<Out, Res>['transform'],
  ): Decoder<In, Res, Query> {
    return super.pipe(transformer) as unknown as Decoder<In, Res, Query>
  }
}

export function createDecoder<In, Out, Query>(options: DecoderOptions<In, Out, Query>) {
  return new Decoder<In, Out, Query>(options)
}
