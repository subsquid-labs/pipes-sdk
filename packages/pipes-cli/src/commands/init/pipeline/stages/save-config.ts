import { PIPE_CONFIG_FILENAME, serializePipeConfig } from '../../config/serialize-config.js'
import type { InitStage } from '../types.js'

export const saveConfigStage: InitStage = {
  id: 'save-config',
  label: 'Saving configuration',
  run: async (ctx) => {
    ctx.projectWriter.createFile(PIPE_CONFIG_FILENAME, serializePipeConfig(ctx.config))
  },
}
