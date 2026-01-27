import { exec } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import chalk from 'chalk'
import ora from 'ora'
import { z } from 'zod'
import {
  type Config,
  type NetworkType,
  networkTypes,
  type PackageManager,
  packageManagerTypes,
  type Sink,
  sinkTypes,
} from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import {
  InvalidNetworkTypeError,
  ProjectAlreadyExistError,
  TemplateFileNotFoundError,
  TemplateNotFoundError,
  UnexpectedTemplateFileError,
} from './init.errors.js'
import { SinkBuilder } from './templates/pipe-components/sink-builder/index.js'
import { TransformerBuilder } from './templates/pipe-components/transformer-builder/index.js'
import { evmTemplates } from './templates/pipe-templates/evm/index.js'
import { svmTemplates } from './templates/pipe-templates/svm/index.js'
import {
  agentsTemplate,
  biomeConfigTemplate,
  gitignoreTemplate,
  pnpmWorkspaceTemplate,
  renderDependencies,
  renderDockerCompose,
  renderDockerfile,
  renderEnvTemplate,
  renderPackageJson,
  renderReadme,
  renderUtilsTemplate,
  tsconfigConfigTemplate,
} from './templates/project-files/index.js'
import { toKebabCase } from '~/utils/string.js'

const execAsync = promisify(exec)

export class ProjectWriter {
  private readonly projectAbsolutePath: string
  constructor(protected config: Config<NetworkType>) {
    this.projectAbsolutePath = path.resolve(config.projectFolder)
  }

  createFile(relativePath: string, content: string) {
    const filePath = path.join(this.projectAbsolutePath, relativePath)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }

  copyFile(absoluteSourcePath: string, relativeTargetPath: string) {
    const absoluteTargetFilePath = path.join(this.projectAbsolutePath, relativeTargetPath)

    if (!existsSync(absoluteSourcePath)) throw new TemplateFileNotFoundError(absoluteSourcePath)

    const sourceStat = statSync(absoluteSourcePath)

    if (sourceStat.isDirectory()) {
      cpSync(absoluteSourcePath, absoluteTargetFilePath, { recursive: true })
    } else if (sourceStat.isFile()) {
      mkdirSync(path.dirname(absoluteTargetFilePath), { recursive: true })
      copyFileSync(absoluteSourcePath, absoluteTargetFilePath)
    } else {
      throw new UnexpectedTemplateFileError(absoluteTargetFilePath)
    }
  }

  executeCommand(command: string) {
    return execAsync(command, {
      cwd: this.projectAbsolutePath,
    })
  }
}

const configJsonSchema = z
  .object({
    // TODO: add regex validation for path
    projectFolder: z.string().min(1),
    networkType: z.enum(
      networkTypes.map((n) => n.value),
      { error: (iss) => InvalidNetworkTypeError.getErrorMessage(iss.input) },
    ),
    packageManager: z.enum(packageManagerTypes.map((p) => p.value)),
    network: z.string().min(1),
    templates: z.array(z.string()),
    contractAddresses: z.array(z.string()),
    sink: z.enum(sinkTypes.map((s) => s.value)),
  })
  .transform((data) => {
    const networkType = data.networkType as NetworkType
    return {
      ...data,
      networkType,
      sink: data.sink as Sink,
      packageManager: data.packageManager as PackageManager,
      templates: data.templates as typeof networkType extends 'evm' ? EvmTemplateIds[] : SvmTemplateIds[],
    }
  })

type ConfigJson = z.infer<typeof configJsonSchema>

type ExtendedConfig = Config<NetworkType> & { projectName: string; projectAbsolutePath: string }

const squidfix = (text: string) => chalk.gray(`[🦑 PIPES SDK] ${text} `)

export class InitHandler {
  private readonly config: ExtendedConfig
  private readonly projectWriter: ProjectWriter

  constructor(config: Config<NetworkType>) {
    const pathParts = config.projectFolder.split('/')

    this.config = {
      ...config,
      projectName: pathParts[pathParts.length - 1] ?? config.projectFolder,
      projectAbsolutePath: path.resolve(config.projectFolder),
    }

    this.projectWriter = new ProjectWriter(this.config)
  }

  async handle(): Promise<void> {
    const spinner = ora('\n\nSetting up new Pipes SDK project...').start()
    try {
      this.checkCurrentProjectPath()

      spinner.text = squidfix('Writing static files')
      this.writeStaticFiles()

      spinner.text = squidfix('Writing template files')
      await this.writeDynamicFiles()

      spinner.text = squidfix('Copying template contracts')
      await this.copyTemplateContracts()

      spinner.text = squidfix('Installing dependencies')
      await this.installDependencies()

      spinner.text = squidfix('Creating main indexer file')
      await this.writeIndexTs()

      spinner.text = squidfix('Creating sink files')
      await this.writeSinkFiles()

      spinner.text = squidfix('Linting project')
      await this.lintProject()

      spinner.succeed(`${squidfix(`${this.config.projectFolder} project initialized successfully`)}`)

      this.nextSteps()
    } catch (error) {
      spinner.fail('Failed to initialize project')
      throw error
    }
  }

  private checkCurrentProjectPath() {
    try {
      const projectStat = statSync(this.config.projectAbsolutePath)

      if (projectStat.isDirectory()) throw new ProjectAlreadyExistError(this.config.projectAbsolutePath)
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
        projectName: this.config.projectName,
        dependencies,
        devDependencies,
        hasPostgresScripts: this.config.sink === 'postgresql',
      }),
    )

    this.projectWriter.createFile(
      'Dockerfile',
      renderDockerfile({
        isPostgres: this.config.sink === 'postgresql',
      }),
    )

    this.projectWriter.createFile(
      'docker-compose.yml',
      renderDockerCompose({
        projectName: this.config.projectName,
        sink: this.config.sink,
      }),
    )

    this.projectWriter.createFile(
      '.env',
      renderEnvTemplate({
        sink: this.config.sink,
      }),
    )

    this.projectWriter.createFile(
      'README.md',
      renderReadme({
        packageManager: this.config.packageManager,
        projectName: this.config.projectName,
        hasPostgresScripts: this.config.sink === 'postgresql',
      }),
    )

    this.projectWriter.createFile('src/utils/index.ts', renderUtilsTemplate(this.config))
  }

  private async writeIndexTs(): Promise<void> {
      const builder = new TransformerBuilder(this.config, this.projectWriter)
      const indexTs = await builder.render()
      this.projectWriter.createFile('src/index.ts', indexTs)
  }

  private async writeSinkFiles(): Promise<void> {
    const builder = new SinkBuilder(this.config, this.projectWriter)
    await builder.createMigrations()
    await builder.createEnvFile()
  }

  private async installDependencies(): Promise<void> {
    // TODO: create execInProject function and reuse it in every function below
    await execAsync(`${this.config.packageManager} install`, {
      cwd: this.config.projectAbsolutePath,
    })
  }

  private async lintProject(): Promise<void> {
    await execAsync(`${this.config.packageManager} run lint`, {
      cwd: this.config.projectAbsolutePath,
    })
  }

  private async copyTemplateContracts(): Promise<void> {
    const templateBaseDir = getTemplateDirname(this.config.networkType)
    let hasContracts = false

    for (const template of this.config.templates) {
      const templateContractsDir = path.join(templateBaseDir, toKebabCase(template.templateId), 'contracts')

      if (existsSync(templateContractsDir)) {
        hasContracts = true
        break
      }
    }

    if (!hasContracts) {
      return
    }

    for (const template of this.config.templates.filter((t) => t.templateId !== 'custom')) {
      const templateContractsDir = path.join(templateBaseDir, toKebabCase(template.templateId), 'contracts')
      this.projectWriter.copyFile(templateContractsDir, 'src/contracts')
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

  static fromJson(jsonString: string): InitHandler {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonString)
      const result = configJsonSchema.safeParse(parsed)

      if (result.error) throw new Error(z.prettifyError(result.error))

      const config = InitHandler.transformToConfig(result.data)

      return new InitHandler(config)
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private static transformToConfig(json: ConfigJson): Config<NetworkType> {
    const { networkType, templates: templateIds, contractAddresses, ...rest } = json
    const selectedTemplates = templateIds.map((id) => {
      if (networkType === 'evm') {
        const template = evmTemplates[id as EvmTemplateIds]
        if (!template) throw new TemplateNotFoundError(id, networkType)
        return template
      } else {
        const template = svmTemplates[id as SvmTemplateIds]
        if (!template) throw new TemplateNotFoundError(id, networkType)
        return template
      }
    })

    return {
      ...rest,
      networkType,
      templates: selectedTemplates,
      contractAddresses,
    } as Config<NetworkType>
  }
}
