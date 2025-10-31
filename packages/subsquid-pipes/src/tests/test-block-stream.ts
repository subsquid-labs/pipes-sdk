import { EvmQueryBuilder } from '~/evm/index.js'
import { PortalRange, Transformer } from '../core/index.js'

export function blockQuery(range: PortalRange) {
  return new EvmQueryBuilder().addRange(range).addFields({
    block: {
      number: true,
      hash: true,
      timestamp: true,
    },
  })
}

export function blockTransformer<
  H extends { number: number; timestamp: number; hash: string },
  T extends { header: H },
>() {
  return new Transformer<{ blocks: T[] }, H[]>({
    transform: (data) => {
      return data.blocks.flatMap((b) => b.header)
    },
  })
}
