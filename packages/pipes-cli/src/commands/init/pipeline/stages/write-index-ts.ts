import { TransformerBuilder } from '../../builders/transformer-builder/index.js'
import type { InitStage } from '../types.js'

export const writeIndexTsStage: InitStage = {
  id: 'write-index-ts',
  label: 'Creating main indexer file',
  run: async (ctx) => {
    const builder = new TransformerBuilder(ctx.config, ctx.projectWriter)
    await builder.writeIndexTs()
    await builder.runPostSetups()
  },
}
