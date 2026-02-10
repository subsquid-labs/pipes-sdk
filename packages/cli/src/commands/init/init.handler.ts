import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import chalk from 'chalk'
import ora from 'ora'
import { z } from 'zod'

import { type Config, type NetworkType, sinkTypes } from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import { ProjectWriter } from '~/utils/project-writer.js'
import { toKebabCase } from '~/utils/string.js'

import { SinkBuilder } from './builders/sink-builder/index.js'
import { TransformerBuilder } from './builders/transformer-builder/index.js'
import { configJsonSchema, configJsonSchemaRaw } from './config/params.js'
import { ProjectAlreadyExistError } from './init.errors.js'
import {
  agentsTemplate,
  biomeConfigTemplate,
  gitignoreTemplate,
  pnpmWorkspaceTemplate,
  renderDependencies,
  renderDockerCompose,
  renderDockerfile,
  renderPackageJson,
  renderReadme,
  renderUtilsTemplate,
  tsconfigConfigTemplate,
} from './templates/config-files/index.js'

export class InitHandler {
  private readonly projectName: string
  private readonly projectWriter: ProjectWriter

  constructor(private config: Config<NetworkType>) {
    const pathParts = config.projectFolder.split('/')
    this.projectName = pathParts[pathParts.length - 1] ?? config.projectFolder
    this.projectWriter = new ProjectWriter(this.config.projectFolder)
  }

  async handle(): Promise<void> {
    const spinner = ora('\n\nSetting up new Pipes SDK project...')
    spinner.prefixText = chalk.gray(`[🦑 PIPES SDK]`)
    spinner.start()

    try {
      this.checkCurrentProjectPath()

      spinner.text = 'Writing static files'
      this.writeStaticFiles()

      spinner.text = 'Writing template files'
      await this.writeDynamicFiles()

      spinner.text = 'Copying template contracts'
      this.copySrcContent()

      spinner.text = 'Installing dependencies'
      await this.installDependencies()

      spinner.text = 'Creating main indexer file'
      await this.writeIndexTs()

      spinner.text = 'Creating sink files'
      await this.writeSinkFiles()

      spinner.text = 'Linting project'
      await this.lintProject()

      spinner.succeed(`${`${this.config.projectFolder} project initialized successfully`}`)

      this.nextSteps()
    } catch (error) {
      spinner.fail('Failed to initialize project')
      throw error
    }
  }

  private checkCurrentProjectPath() {
    try {
      const absolutePath = this.projectWriter.getAbsolutePath()
      const projectStat = statSync(absolutePath)
      if (projectStat.isDirectory()) throw new ProjectAlreadyExistError(absolutePath)
    } catch (e) {
      if ((e as any).code === 'ENOENT') return
      throw e
    }
  }

  private writeStaticFiles(): void {
    const staticFiles: { name: string; template: string }[] = [
      { name: 'biome.json', template: biomeConfigTemplate },
      { name: 'tsconfig.json', template: tsconfigConfigTemplate },
      { name: '.gitignore', template: gitignoreTemplate },
      { name: 'AGENTS.md', template: agentsTemplate },
    ]

    for (const { name, template } of staticFiles) {
      this.projectWriter.createFile(name, template)
    }

    if (this.config.packageManager === 'pnpm') {
      this.projectWriter.createFile('pnpm-workspace.yaml', pnpmWorkspaceTemplate)
    }
  }

  // TODO: create single interface for all render methods
  private async writeDynamicFiles(): Promise<void> {
    const { dependencies, devDependencies } = renderDependencies(this.config.sink)
    this.projectWriter.createFile(
      'package.json',
      renderPackageJson({
        projectName: this.projectName,
        dependencies,
        devDependencies,
        hasPostgresScripts: this.config.sink === 'postgresql',
        packageManager: this.config.packageManager,
      }),
    )

    this.projectWriter.createFile(
      'Dockerfile',
      renderDockerfile({
        isPostgres: this.config.sink === 'postgresql',
        packageManager: this.config.packageManager,
      }),
    )

    this.projectWriter.createFile(
      'docker-compose.yml',
      renderDockerCompose({
        projectName: this.projectName,
        sink: this.config.sink,
      }),
    )

    this.projectWriter.createFile(
      'README.md',
      renderReadme({
        packageManager: this.config.packageManager,
        projectName: this.projectName,
        hasPostgresScripts: this.config.sink === 'postgresql',
      }),
    )

    this.projectWriter.createFile('src/utils/index.ts', renderUtilsTemplate(this.config))
  }

  private async writeIndexTs(): Promise<void> {
    const builder = new TransformerBuilder(this.config, this.projectWriter)
    await builder.writeIndexTs()
    await builder.runPostSetups()
  }

  private async writeSinkFiles(): Promise<void> {
    const builder = new SinkBuilder(this.config, this.projectWriter)
    builder.createEnvFile()
    await builder.createMigrations()
  }

  private async installDependencies(): Promise<void> {
    await this.projectWriter.executeCommand(`${this.config.packageManager} install`)
  }

  private async lintProject(): Promise<void> {
    await this.projectWriter.executeCommand(`${this.config.packageManager} run lint`)
  }

  private copySrcContent() {
    for (const template of this.config.templates) {
      const temlateSrcDir = path.join(
        getTemplateDirname(this.config.networkType),
        toKebabCase(template.templateId),
        'src',
      )
      const hasSrc = existsSync(temlateSrcDir)

      if (hasSrc) {
        this.projectWriter.copyFile(temlateSrcDir, 'src')
      }
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

  2) Start your ${sinkTypes.find((s) => s.value === this.config.sink)?.name} database
     ${chalk.gray.italic('docker compose up -d')}

  ${this.config.sink === 'postgresql' ? pgMessage : clickhouseMessage}

  ${chalk.gray('Need help? Check our documentation at')} ${chalk.bold.gray.underline('https://beta.docs.sqd.dev/en/sdk/pipes-sdk')}`

    console.log(message)
  }

  static fromFile(filePath: string): InitHandler {
    return InitHandler.fromJson(readFileSync(filePath, 'utf8'))
  }

  static fromJson(jsonString: string): InitHandler {
    const result = configJsonSchema.parse(JSON.parse(jsonString))
    return new InitHandler(result)
  }

  static jsonSchema() {
    console.log(JSON.stringify(z.toJSONSchema(configJsonSchemaRaw), null, 2))
  }
}
