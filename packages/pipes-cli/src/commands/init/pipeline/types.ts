import type { Config, NetworkType } from '~/types/init.js'
import type { ProjectWriter } from '~/utils/project-writer.js'

export type InitContext = {
  config: Config<NetworkType>
  projectName: string
  projectPath: string
  projectWriter: ProjectWriter
}

export type InitStage = {
  id: string
  label: string
  run: (ctx: InitContext) => Promise<void>
}
