import { createTransformer } from '../core'

export function blockTransformer<
  H extends { number: number; timestamp: number; hash: string },
  T extends { header: H },
>() {
  return createTransformer<{ blocks: T[] }, H[]>({
    transform: (data) => {
      return data.blocks.flatMap((b) => b.header)
    },
  })
}
