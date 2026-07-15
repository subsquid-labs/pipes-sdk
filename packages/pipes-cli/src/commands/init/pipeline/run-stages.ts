import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { InitPipelineError } from './errors.js'
import type { InitContext, InitStage } from './types.js'

export type PipelineSpinner = { text: string }

export type StageFailure = { stageId: string; label: string; error: Error }

export type RunStagesOptions = {
  cleanup?: (projectPath: string) => Promise<void>
  spinner?: PipelineSpinner
}

/**
 * Runs the init stages in order. An essential stage failure aborts the pipeline
 * (removing the partial project); an `optional` stage failure is collected and
 * returned so the caller can surface it while still finishing the project and
 * printing next steps.
 */
export async function runStages(
  stages: InitStage[],
  ctx: InitContext,
  options: RunStagesOptions = {},
): Promise<StageFailure[]> {
  const cleanup = options.cleanup ?? defaultCleanup
  const failures: StageFailure[] = []

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!
    if (options.spinner) options.spinner.text = stage.label
    try {
      await stage.run(ctx)
    } catch (error) {
      if (stage.optional) {
        failures.push({ stageId: stage.id, label: stage.label, error: error as Error })
        continue
      }

      const pipelineError = new InitPipelineError(stage.id, error as Error)
      if (i > 0 && isSafeToRemove(ctx.projectPath)) {
        try {
          await cleanup(ctx.projectPath)
        } catch {
          // Cleanup failure must not mask the original pipeline error.
        }
      }
      throw pipelineError
    }
  }

  return failures
}

async function defaultCleanup(projectPath: string): Promise<void> {
  await rm(projectPath, { recursive: true, force: true })
}

function isSafeToRemove(projectPath: string): boolean {
  if (!projectPath || projectPath.trim().length === 0) return false
  const resolved = path.resolve(projectPath)
  if (resolved === path.parse(resolved).root) return false
  if (resolved === path.resolve(homedir())) return false
  return true
}
