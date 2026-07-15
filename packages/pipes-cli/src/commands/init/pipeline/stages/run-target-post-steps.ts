import { buildTarget } from '../../builders/target-builder/index.js'
import type { InitStage } from '../types.js'

export const runTargetPostStepsStage: InitStage = {
  id: 'target-post-steps',
  label: 'Finalizing target setup',
  // Non-fatal: the target's post-steps (e.g. Postgres `db:generate`) run the
  // package manager and need installed deps, so they shouldn't discard the
  // project when install failed.
  optional: true,
  run: async (ctx) => {
    const { postSteps } = buildTarget(ctx.config)
    for (const step of postSteps) {
      await ctx.projectWriter.executeCommand(step.command)
    }
  },
}
