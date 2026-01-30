import chalk from 'chalk'
import ora, { Ora } from 'ora'

export class CliStep {
  private spinner: Ora

  constructor(title: string) {
    console.log(` ${chalk.gray('[🦑 PIPES SDK]')} ${chalk.bold(title)}`)
    this.spinner = ora()
    this.spinner.indent = 2
    this.spinner.start()
  }

  async step<T>(stepName: string, stepFn: () => Promise<T> | T) {
    this.spinner.text = chalk.italic(stepName)
    return stepFn()
  }

  finalMessage(message: string) {
    this.spinner.succeed(message)
    this.spinner.stop()
    this.spinner.clear()
    console.log('')
  }
}
