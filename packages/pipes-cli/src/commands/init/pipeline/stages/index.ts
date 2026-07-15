import type { InitStage } from '../types.js'
import { checkProjectPathStage } from './check-project-path.js'
import { copySrcContentStage } from './copy-src-content.js'
import { generateTypesStage } from './generate-types.js'
import { installDependenciesStage } from './install-dependencies.js'
import { lintProjectStage } from './lint-project.js'
import { runTargetPostStepsStage } from './run-target-post-steps.js'
import { saveConfigStage } from './save-config.js'
import { writeConfigFilesStage } from './write-config-files.js'
import { writeIndexTsStage } from './write-index-ts.js'
import { writeTargetFilesStage } from './write-target-files.js'

export {
  checkProjectPathStage,
  copySrcContentStage,
  generateTypesStage,
  installDependenciesStage,
  lintProjectStage,
  runTargetPostStepsStage,
  saveConfigStage,
  writeConfigFilesStage,
  writeIndexTsStage,
  writeTargetFilesStage,
}

// Essential stages generate the project (pure file writes); optional stages run
// external tools (install, typegen, target setup, lint) whose failures are
// surfaced but never discard the finished project or block the final instructions.
export const initStages: InitStage[] = [
  checkProjectPathStage,
  writeConfigFilesStage,
  copySrcContentStage,
  writeIndexTsStage,
  writeTargetFilesStage,
  saveConfigStage,
  installDependenciesStage,
  generateTypesStage,
  runTargetPostStepsStage,
  lintProjectStage,
]
