import { TransformerBuilder } from '../../builders/transformer-builder/index.js'
import type { InitStage } from '../types.js'

export const writeIndexTsStage: InitStage = {
  id: 'write-index-ts',
  label: 'Creating main indexer file',
  run: async (ctx) => {
    // File generation only; typegen (runPostSetups) runs in the optional
    // generate-types stage so its shell-out can fail without discarding the project.
    const builder = new TransformerBuilder(ctx.config, ctx.projectWriter)
    await builder.writeIndexTs()
  },
}
