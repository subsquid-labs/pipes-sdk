import chalk from 'chalk'

import type { PromptContext } from './define-template.js'

/**
 * Thrown when the user backs out of a template's prompt. The template loop
 * catches it and returns to template selection instead of tearing down the
 * whole init session.
 */
export class TemplatePromptCancelled extends Error {
  constructor() {
    super('Template prompt cancelled')
    this.name = 'TemplatePromptCancelled'
  }
}

/**
 * Ctrl-C surfaces from @inquirer as an `ExitPromptError`; that (and our own
 * cancel sentinel) must propagate and end the process. Everything else raised
 * while prompting is a fixable input problem the user can retry.
 */
export function isFatalPromptError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'ExitPromptError' || error instanceof TemplatePromptCancelled)
}

function printRecoverableError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)

  console.log('')
  console.log(`${chalk.red('✗')} ${message}`)
  console.log('')
}

/**
 * Runs a block of prompts + remote lookups and, on any recoverable failure,
 * shows the error and lets the user retry the block or skip the template. A bad
 * address or unverified contract thus never aborts the session — only SIGINT/
 * SIGTERM (surfaced as `ExitPromptError`) exits.
 */
export async function withPromptRetry<T>(
  ctx: Pick<PromptContext, 'select'>,
  retryLabel: string,
  action: () => Promise<T>,
): Promise<T> {
  while (true) {
    try {
      return await action()
    } catch (error) {
      if (isFatalPromptError(error)) throw error

      printRecoverableError(error)
      const choice = await ctx.select<'retry' | 'skip'>('What would you like to do?', [
        { name: retryLabel, value: 'retry' },
        { name: 'Skip this template (back to template selection)', value: 'skip' },
      ])

      if (choice === 'skip') throw new TemplatePromptCancelled()
    }
  }
}
