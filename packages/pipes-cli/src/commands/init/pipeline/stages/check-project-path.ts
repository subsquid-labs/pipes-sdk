import { statSync } from 'node:fs'

import { ProjectAlreadyExistError } from '../../init.errors.js'
import type { InitStage } from '../types.js'

export const checkProjectPathStage: InitStage = {
  id: 'check-project-path',
  label: 'Checking project path',
  run: async (ctx) => {
    try {
      const projectStat = statSync(ctx.projectPath)
      if (projectStat.isDirectory()) throw new ProjectAlreadyExistError(ctx.projectPath)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
  },
}
