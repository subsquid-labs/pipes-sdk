import type { InitStage } from '../types.js'

export const lintProjectStage: InitStage = {
  id: 'lint-project',
  label: 'Linting project',
  // Non-fatal: lint runs the package manager (and needs deps installed), so it
  // shouldn't discard the project when install failed or the linter trips.
  optional: true,
  run: async (ctx) => {
    await ctx.projectWriter.executeCommand(`${ctx.config.packageManager} run lint`)
  },
}
