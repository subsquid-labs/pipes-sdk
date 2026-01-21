import { EvmQueryBuilder } from '~/evm/evm-query-builder.js'

import { Decoder, PortalRange } from '../core/index.js'

export function blockDecoder<H extends { number: number; timestamp: number; hash: string }, T extends { header: H }>(
  range: PortalRange,
) {
  return new Decoder<T[], H[], EvmQueryBuilder>({
    query: ({ queryBuilder }) => {
      queryBuilder.addRange(range).addFields({
        block: {
          number: true,
          hash: true,
          timestamp: true,
        },
      })
    },
    transform: (data) => {
      return data.flatMap((b) => b.header)
    },
  })
}
