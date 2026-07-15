import { readFileSync } from 'node:fs'

import chalk from 'chalk'
import { z } from 'zod'

import { type Config, type NetworkType, targetTypes } from '~/types/init.js'
import { deriveProjectName } from '~/utils/project-name.js'
import { ProjectWriter } from '~/utils/project-writer.js'
import { createSpinner } from '~/utils/spinner.js'

import { CONFIG_SCHEMA_URL, configJsonSchema, configJsonSchemaRaw } from './config/params.js'
import { prepareConfig } from './config/prepare-config.js'
import { type InitContext, initStages, runStages } from './pipeline/index.js'

export class InitHandler {
  private readonly projectName: string
  private readonly projectWriter: ProjectWriter

  constructor(private config: Config<NetworkType>) {
    this.projectName = deriveProjectName(config.projectFolder)
    this.projectWriter = new ProjectWriter(this.config.projectFolder)
  }

  async handle(): Promise<void> {
    const spinner = createSpinner('Setting up new Pipes SDK project...')
    spinner.start()

    const ctx: InitContext = {
      config: this.config,
      projectName: this.projectName,
      projectPath: this.projectWriter.getAbsolutePath(),
      projectWriter: this.projectWriter,
    }

    try {
      await runStages(initStages, ctx, { spinner })
      spinner.succeed(`${this.config.projectFolder} project initialized successfully`)
      this.nextSteps()
    } catch (error) {
      spinner.fail('Failed to initialize project')
      throw error
    }
  }

  private nextSteps(): void {
    const sep = `${chalk.green('─'.repeat(64))}`

    const pgMessage = `3) Apply migrations
     ${chalk.gray.italic(`${this.config.packageManager} run db:migrate`)}

  4) Start the pipeline
     ${chalk.gray.italic(`${this.config.packageManager} run dev`)}`

    const clickhouseMessage = `3) Start the pipeline
     ${chalk.gray.italic(`${this.config.packageManager} run dev`)}`

    const message = `
  ${sep}

            ${chalk.bold.green('🦑 YOUR PIPES SDK PROJECT IS READY TO GO 🦑')}

  ${sep}

  ${chalk.gray.bold("What's next?")}


  ${chalk.bold.yellow('⚡ QUICKSTART')}

  1) Enter the project folder
    ${chalk.gray.italic(`cd ${this.config.projectFolder}`)}

  2) Start collecting data
    ${chalk.gray.italic('docker compose --profile with-pipeline up')}


  ${chalk.bold.blue('💻 DEVELOPMENT')}

  1) Enter the project folder
     ${chalk.gray.italic(`cd ${this.config.projectFolder}`)}

  2) Start your ${targetTypes.find((t) => t.value === this.config.target)?.name} database
     ${chalk.gray.italic('docker compose up -d')}

  ${this.config.target === 'postgresql' ? pgMessage : clickhouseMessage}

  ${chalk.gray('Need help? Check our documentation at')} ${chalk.bold.gray.underline('https://docs.sqd.dev/en/sdk/pipes-sdk')}`

    console.log(message)
  }

  static async fromFile(filePath: string): Promise<InitHandler> {
    const config = InitHandler.parseConfig(readFileSync(filePath, 'utf8'))
    await prepareConfig(config)
    return new InitHandler(config)
  }

  static async fromJson(jsonString: string): Promise<InitHandler> {
    const config = InitHandler.parseConfig(jsonString)
    await prepareConfig(config)
    return new InitHandler(config)
  }

  static parseConfig(jsonString: string): Config<NetworkType> {
    return configJsonSchema.parse(JSON.parse(jsonString))
  }

  static jsonSchema() {
    const { $schema, ...rest } = z.toJSONSchema(configJsonSchemaRaw) as Record<string, unknown>
    const schema = { $schema, $id: CONFIG_SCHEMA_URL, title: 'Subsquid Pipes CLI configuration', ...rest }
    console.log(JSON.stringify(schema, null, 2))
  }
}
