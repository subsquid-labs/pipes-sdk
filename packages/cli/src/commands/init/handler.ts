import { exec } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import chalk from 'chalk'
import ora from 'ora'
import { z } from 'zod'
import { getEvmChainId } from '~/commands/init/config/networks.js'
import { SqdAbiService } from '~/services/sqd-abi.js'
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
import { EvmTemplateIds, SvmTemplateIds } from './config/templates.js'
import { InvalidNetworkTypeError, TemplateNotFoundError } from './errors.js'
import { EvmTemplateBuilder } from './templates/pipe-components/evm-template-builder.js'
import { renderSchemasTemplate } from './templates/pipe-components/schemas-template.js'
import { SvmTemplateBuilder } from './templates/pipe-components/svm-template-builder.js'
import { evmTemplates } from './templates/pipe-templates/evm/index.js'
import { svmTemplates } from './templates/pipe-templates/svm/index.js'
import {
  biomeConfigTemplate,
  clickhouseUtilsTemplate,
  drizzleConfigTemplate,
  gitignoreTemplate,
  pnpmWorkspaceTemplate,
  renderDependencies,
  renderDockerCompose,
  renderDockerfile,
  renderEnvTemplate,
  renderPackageJson,
  renderReadme,
  tsconfigConfigTemplate,
} from './templates/project-files/index.js'

const execAsync = promisify(exec)

const configJsonSchema = z
  .object({
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

type ConfigWithName = Config<NetworkType> & { projectName: string }

const squidfix = (text: string) => chalk.gray(`[🦑 PIPES SDK] ${text} `)

export class InitHandler {
  private readonly config: ConfigWithName

  constructor(config: Config<NetworkType>) {
    const pathParts = config.projectFolder.split('/')

    this.config = {
      ...config,
      projectName: pathParts[pathParts.length - 1] ?? config.projectFolder,
    }
  }

  async handle(): Promise<void> {
    const spinner = ora('\n\nSetting up new Pipes SDK project...').start()
    try {
      spinner.text = squidfix('Creating project folder')
      await this.createProjectFolder(this.config.projectFolder)

      const projectPath = path.resolve(this.config.projectFolder)

      await mkdir(path.join(projectPath, 'src'), { recursive: true })

      spinner.text = squidfix('Writing static files')
      this.writeStaticFiles(projectPath)

      spinner.text = squidfix('Writing template files')
      this.writeTemplateFiles(projectPath)

      if (this.config.sink === 'clickhouse') {
        spinner.text = squidfix('Copying ClickHouse migrations')
        await this.copyClickHouseMigrations(projectPath)
      }

      spinner.text = squidfix('Copying template contracts')
      await this.copyTemplateContracts(projectPath)

      spinner.text = squidfix('Installing dependencies')
      await this.installDependencies(projectPath)

      spinner.text = squidfix('Linting project')
      await this.lintProject(projectPath)

      if (this.config.contractAddresses.length > 0) {
        spinner.text = squidfix('Generating contract types')
        await this.generateContractTypes(projectPath)
      }

      if (this.config.sink === 'postgresql') {
        spinner.text = squidfix('Generating database migrations')
        await this.generateDatabaseMigrations(projectPath)
      }

      spinner.succeed(`${squidfix(`${this.config.projectFolder} project initialized successfully`)}`)

      this.nextSteps(projectPath)
    } catch (error) {
      spinner.fail('Failed to initialize project')
      throw error
    }
  }

  private async createProjectFolder(folder: string): Promise<void> {
    if (folder === '.') {
      return
    }

    const fullPath = path.resolve(folder)

    if (existsSync(fullPath)) {
      throw new Error(`Project folder ${fullPath} already exists`)
    }

    await mkdir(fullPath, { recursive: true })
  }

  private writeStaticFiles(projectPath: string): void {
    writeFileSync(path.join(projectPath, 'biome.json'), JSON.stringify(biomeConfigTemplate, null, 2))
    writeFileSync(path.join(projectPath, 'tsconfig.json'), JSON.stringify(tsconfigConfigTemplate, null, 2))
    writeFileSync(path.join(projectPath, '.gitignore'), gitignoreTemplate)

    if (this.config.packageManager === 'pnpm') {
      writeFileSync(path.join(projectPath, 'pnpm-workspace.yaml'), pnpmWorkspaceTemplate)
    }
  }

  private writeTemplateFiles(projectPath: string): void {
    const { dependencies, devDependencies } = renderDependencies(this.config.sink)
    writeFileSync(
      path.join(projectPath, 'package.json'),
      renderPackageJson({
        projectName: this.config.projectName,
        dependencies,
        devDependencies,
        hasPostgresScripts: this.config.sink === 'postgresql',
      }),
    )

    writeFileSync(
      path.join(projectPath, 'Dockerfile'),
      renderDockerfile({
        isPostgres: this.config.sink === 'postgresql',
      }),
    )

    writeFileSync(
      path.join(projectPath, 'docker-compose.yml'),
      renderDockerCompose({
        projectName: this.config.projectName,
        sink: this.config.sink,
      }),
    )

    writeFileSync(
      path.join(projectPath, '.env'),
      renderEnvTemplate({
        sink: this.config.sink,
      }),
    )

    writeFileSync(
      path.join(projectPath, 'README.md'),
      renderReadme({
        packageManager: this.config.packageManager,
        projectName: this.config.projectName,
        hasPostgresScripts: this.config.sink === 'postgresql',
      }),
    )

    writeFileSync(path.join(projectPath, 'src/index.ts'), this.renderIndexerTs())

    if (this.config.sink === 'postgresql') {
      writeFileSync(path.join(projectPath, 'drizzle.config.ts'), drizzleConfigTemplate)

      const schemasTs = renderSchemasTemplate(this.config)
      writeFileSync(path.join(projectPath, 'src/schemas.ts'), schemasTs)
    }

    if (this.config.sink === 'clickhouse') {
      const utilsDir = path.join(projectPath, 'src/utils')
      mkdirSync(utilsDir, { recursive: true })
      writeFileSync(path.join(utilsDir, 'index.ts'), clickhouseUtilsTemplate)
    }
  }

  private renderIndexerTs(): string {
    if (this.config.networkType === 'evm') {
      const builder = new EvmTemplateBuilder(this.config as Config<'evm'>)
      return builder.build()
    }
    if (this.config.networkType === 'svm') {
      const builder = new SvmTemplateBuilder(this.config as Config<'svm'>)
      return builder.build()
    }

    throw new InvalidNetworkTypeError(this.config.networkType)
  }

  private async installDependencies(projectPath: string): Promise<void> {
    await execAsync(`${this.config.packageManager} install`, {
      cwd: projectPath,
    })
  }

  private async lintProject(projectPath: string): Promise<void> {
    await execAsync(`${this.config.packageManager} run lint`, {
      cwd: projectPath,
    })
  }

  private async generateDatabaseMigrations(projectPath: string): Promise<void> {
    await execAsync(`${this.config.packageManager} run db:generate`, {
      cwd: projectPath,
    })
  }

  private async copyClickHouseMigrations(projectPath: string): Promise<void> {
    const defaultMigrationFileName = 'clickhouse-table.sql'
    const templateBaseDir = getTemplateDirname(this.config.networkType)
    const migrationsDir = path.join(projectPath, 'migrations')
    await mkdir(migrationsDir, { recursive: true })

    for (const template of this.config.templates) {
      const sourceFile = path.join(templateBaseDir, template.folderName, defaultMigrationFileName)

      if (existsSync(sourceFile)) {
        const targetFile = path.join(migrationsDir, `${template.folderName}-migration.sql`)
        copyFileSync(sourceFile, targetFile)
      }
    }

    // Handle custom contract template if present
    if (this.config.contractAddresses.length > 0) {
      const customContractSourceFile = path.join(templateBaseDir, 'custom', defaultMigrationFileName)

      if (existsSync(customContractSourceFile)) {
        const targetFile = path.join(migrationsDir, 'custom-contract-migration.sql')
        copyFileSync(customContractSourceFile, targetFile)
      }
    }
  }

  private async copyTemplateContracts(projectPath: string): Promise<void> {
    const templateBaseDir = getTemplateDirname(this.config.networkType)
    let hasContracts = false

    for (const template of this.config.templates) {
      const templateContractsDir = path.join(templateBaseDir, template.folderName, 'contracts')

      if (existsSync(templateContractsDir)) {
        hasContracts = true
        break
      }
    }

    if (!hasContracts) {
      return
    }

    const projectContractsDir = path.join(projectPath, 'src/contracts')
    await mkdir(projectContractsDir, { recursive: true })

    for (const template of this.config.templates) {
      const templateContractsDir = path.join(templateBaseDir, template.folderName, 'contracts')

      if (existsSync(templateContractsDir)) {
        this.copyDirectoryRecursive(templateContractsDir, projectContractsDir)
      }
    }
  }

  private copyDirectoryRecursive(sourceDir: string, targetDir: string): void {
    const entries = readdirSync(sourceDir)

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry)
      const targetPath = path.join(targetDir, entry)
      const stat = statSync(sourcePath)

      if (stat.isDirectory()) {
        mkdirSync(targetPath, { recursive: true })
        this.copyDirectoryRecursive(sourcePath, targetPath)
      } else {
        copyFileSync(sourcePath, targetPath)
      }
    }
  }

  private async generateContractTypes(projectPath: string): Promise<void> {
    await mkdir(path.join(projectPath, 'src/contracts'), { recursive: true })

    const abiService = new SqdAbiService()

    if (this.config.networkType === 'evm') {
      const chainId = getEvmChainId(this.config.network)
      if (!chainId) {
        return
      }
      abiService.generateEvmTypes(projectPath, this.config.contractAddresses, chainId)
    } else {
      abiService.generateSolanaTypes(projectPath, this.config.contractAddresses)
    }
  }

  private nextSteps(projectPath: string): void {
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
    ${chalk.gray.italic(`cd ${projectPath}`)}

  2) Start collecting data
    ${chalk.gray.italic('docker compose --profile with-pipeline up')}


  ${chalk.bold.blue('💻 DEVELOPMENT')}

  1) Enter the project folder
     ${chalk.gray.italic(`cd ${projectPath}`)}

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
