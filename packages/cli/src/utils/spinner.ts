import chalk from 'chalk'
import ora from 'ora'

export function createSpinner(message: string) {
  return ora({
    prefixText: chalk.gray(`[🦑 PIPES SDK]`),
    text: message,
    stream: process.stdout,
    discardStdin: false,
    isEnabled: true,
  })
}