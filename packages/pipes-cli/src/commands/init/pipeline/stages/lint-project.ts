import type { InitStage } from '../types.js'

export const lintProjectStage: InitStage = {
  id: 'lint-project',
  label: 'Linting project',
  run: async (ctx) => {
    await ctx.projectWriter.executeCommand(`${ctx.config.packageManager} run lint`)
  },
}
