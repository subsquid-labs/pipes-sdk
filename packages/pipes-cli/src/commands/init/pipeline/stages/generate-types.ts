import { TransformerBuilder } from '../../builders/transformer-builder/index.js'
import type { InitStage } from '../types.js'

export const generateTypesStage: InitStage = {
  id: 'generate-types',
  label: 'Generating contract types',
  // Non-fatal: typegen shells out (npx), so a network/registry failure shouldn't
  // discard the project — the user can re-run it afterwards.
  optional: true,
  run: async (ctx) => {
    const builder = new TransformerBuilder(ctx.config, ctx.projectWriter)
    await builder.runPostSetups()
  },
}
