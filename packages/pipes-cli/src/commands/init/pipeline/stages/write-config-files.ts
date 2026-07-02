import { planConfigFiles } from '../../templates/config-files/index.js'
import type { InitStage } from '../types.js'

export const writeConfigFilesStage: InitStage = {
  id: 'write-config-files',
  label: 'Writing config files',
  run: async (ctx) => {
    for (const { path, contents } of planConfigFiles(ctx.config, ctx.projectName)) {
      ctx.projectWriter.createFile(path, contents)
    }
  },
}
