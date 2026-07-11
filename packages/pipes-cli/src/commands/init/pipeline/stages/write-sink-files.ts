import { buildSink } from '../../builders/sink-builder/index.js'
import type { InitStage } from '../types.js'

export const writeSinkFilesStage: InitStage = {
  id: 'write-sink-files',
  label: 'Creating target files',
  run: async (ctx) => {
    const artifacts = buildSink(ctx.config)
    for (const file of artifacts.files) {
      ctx.projectWriter.createFile(file.path, file.content)
    }
    for (const step of artifacts.postSteps) {
      await ctx.projectWriter.executeCommand(step.command)
    }
  },
}
