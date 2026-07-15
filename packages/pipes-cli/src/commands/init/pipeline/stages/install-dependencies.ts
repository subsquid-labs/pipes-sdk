import type { InitStage } from '../types.js'

export const installDependenciesStage: InitStage = {
  id: 'install-dependencies',
  label: 'Installing dependencies',
  // Non-fatal: registry/version/network issues shouldn't discard the project.
  // The project is still generated and the user can install manually.
  optional: true,
  run: async (ctx) => {
    await ctx.projectWriter.executeCommand(`${ctx.config.packageManager} install`)
  },
}
