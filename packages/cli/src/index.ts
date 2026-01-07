import { program } from 'commander'
import { InitPrompt } from './commands/init/prompt.js'
import { InitHandler } from './commands/init/handler.js'

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'An unexpected error occurred'
}

program.name('pipes').description('Subsquid Pipes CLI').version('0.1.0')

program
  .command('init')
  .description('Initialize a new pipe project')
  .option('--config <json>', 'JSON configuration string to skip prompts')
  .action(async (options) => {
    try {
      if (options.config) {
        const handler = InitHandler.fromJson(options.config)
        await handler.handle()
      } else {
        const initConfig = new InitPrompt()
        await initConfig.run()
      }
    } catch (error) {
      console.error(`\n❌ Error: ${formatError(error)}`)
      process.exit(1)
    }
  })

try {
  program.parse()
} catch (error) {
  console.error(`\n❌ Error: ${formatError(error)}`)
  process.exit(1)
}
