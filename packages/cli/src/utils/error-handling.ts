import chalk from 'chalk'

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unexpected error occurred'
}

export function withErrorHandling(fn: (options: any) => Promise<void>) {
  return async (options: any) => {
    try {
      await fn(options)
    } catch (error) {
      console.log(chalk.red('✗'), `Error: ${formatError(error)}`)
      process.exit(1)
    }
  }
}
