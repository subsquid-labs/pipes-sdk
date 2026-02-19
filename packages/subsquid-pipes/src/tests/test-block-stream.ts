import { evmQuery } from '~/evm/evm-query-builder.js'

import { PortalRange } from '../core/index.js'

export function blockDecoder(range: PortalRange) {
  return evmQuery()
    .addRange(range)
    .addFields({
      block: {
        number: true,
        hash: true,
        timestamp: true,
      },
    })
    .build((d) => d.flatMap((b) => b.header))
}
