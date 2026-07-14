import { buildTarget } from '../../builders/target-builder/index.js'
import type { InitStage } from '../types.js'

export const writeTargetFilesStage: InitStage = {
  id: 'write-target-files',
  label: 'Creating target files',
  run: async (ctx) => {
    const artifacts = buildTarget(ctx.config)
    for (const file of artifacts.files) {
      ctx.projectWriter.createFile(file.path, file.content)
    }
    for (const step of artifacts.postSteps) {
      await ctx.projectWriter.executeCommand(step.command)
    }
  },
}
