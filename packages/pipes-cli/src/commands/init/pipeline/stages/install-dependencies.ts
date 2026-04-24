import type { InitStage } from '../types.js'

export const installDependenciesStage: InitStage = {
  id: 'install-dependencies',
  label: 'Installing dependencies',
  run: async (ctx) => {
    await ctx.projectWriter.executeCommand(`${ctx.config.packageManager} install`)
  },
}
