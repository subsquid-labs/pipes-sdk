import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { InitPipelineError } from './errors.js'
import type { InitContext, InitStage } from './types.js'

export type PipelineSpinner = { text: string }

export type RunStagesOptions = {
  cleanup?: (projectPath: string) => Promise<void>
  spinner?: PipelineSpinner
}

export async function runStages(stages: InitStage[], ctx: InitContext, options: RunStagesOptions = {}): Promise<void> {
  const cleanup = options.cleanup ?? defaultCleanup

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]!
    if (options.spinner) options.spinner.text = stage.label
    try {
      await stage.run(ctx)
    } catch (error) {
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
