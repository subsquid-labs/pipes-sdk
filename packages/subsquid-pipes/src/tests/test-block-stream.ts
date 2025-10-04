import { Transformer } from '../core/index.js'

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
