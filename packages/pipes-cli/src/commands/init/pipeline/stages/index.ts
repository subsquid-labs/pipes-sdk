import type { InitStage } from '../types.js'
import { checkProjectPathStage } from './check-project-path.js'
import { copySrcContentStage } from './copy-src-content.js'
import { installDependenciesStage } from './install-dependencies.js'
import { lintProjectStage } from './lint-project.js'
import { writeConfigFilesStage } from './write-config-files.js'
import { writeIndexTsStage } from './write-index-ts.js'
import { writeTargetFilesStage } from './write-target-files.js'

export {
  checkProjectPathStage,
  copySrcContentStage,
  installDependenciesStage,
  lintProjectStage,
  writeConfigFilesStage,
  writeIndexTsStage,
  writeTargetFilesStage,
}

export const initStages: InitStage[] = [
  checkProjectPathStage,
  writeConfigFilesStage,
  copySrcContentStage,
  installDependenciesStage,
  writeIndexTsStage,
  writeTargetFilesStage,
  lintProjectStage,
]
