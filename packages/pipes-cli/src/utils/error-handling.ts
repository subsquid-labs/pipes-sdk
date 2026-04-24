import chalk from 'chalk'
import { ZodError } from 'zod'

function formatError(error: unknown): string {
  let message: string | undefined = undefined

  if (error instanceof ZodError) {
    message = error.issues
      .map((i) =>
        i.code === 'invalid_value'
          ? `${chalk.bold('Invalid value for')} ${chalk.cyan(`\`${i.path.join('.')}\``)}. Expected one of: ${chalk.yellow(i.values.join(', '))}`
          : i.message,
      )
      .join('\n')
  } else if (error instanceof Error) {
    message = error.message
  } else if (typeof error === 'string') {
    message = error
  }

  return message
    ? `${chalk.gray('[🦑 PIPES SDK]')} ${chalk.red('✗ Error:')} ${message}`
    : 'An unexpected error occurred'
}

export function withErrorHandling(fn: (options: any) => Promise<void>) {
  return async (options: any) => {
    try {
      await fn(options)
    } catch (error) {
      console.log('')
      console.log(formatError(error))
      console.log('')
      process.exit(1)
    }
  }
}
