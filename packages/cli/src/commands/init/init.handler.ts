import { exec } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import chalk from 'chalk'
import ora from 'ora'
import { z } from 'zod'
import { getEvmChainId } from '~/commands/init/config/networks.js'
import { type ContractMetadata, SqdAbiService } from '~/services/sqd-abi.js'
import {
  type Config,
  type NetworkType,
  networkTypes,
  type PackageManager,
  packageManagerTypes,
  type Sink,
  sinkTypes,
  type WithContractMetadata,
} from '~/types/init.js'
import { getTemplateDirname } from '~/utils/fs.js'
import type { EvmTemplateIds, SvmTemplateIds } from './config/templates.js'
import {
  InvalidNetworkTypeError,
  ProjectAlreadyExistError,
  TemplateFileNotFoundError,
  TemplateNotFoundError,
  UnexpectedTemplateFileError,
} from './init.errors.js'
import { EvmTemplateBuilder } from './templates/pipe-components/evm-template-builder.js'
import { renderSchemasTemplate } from './templates/pipe-components/schemas-template.js'
import { SvmTemplateBuilder } from './templates/pipe-components/svm-template-builder.js'
import { TemplateBuilder } from './templates/pipe-components/template-builder.js'
import { renderCustomClickhouseTables } from './templates/pipe-templates/evm/custom/clickhouse-table.sql.js'
import { evmTemplates } from './templates/pipe-templates/evm/index.js'
import { svmTemplates } from './templates/pipe-templates/svm/index.js'
import {
  agentsTemplate,
  biomeConfigTemplate,
  drizzleConfigTemplate,
  eventEnricherUtilsTemplate,
  gitignoreTemplate,
  pnpmWorkspaceTemplate,
  renderDependencies,
  renderDockerCompose,
  renderDockerfile,
  renderEnvTemplate,
  renderPackageJson,
  renderReadme,
  snakeCaseUtilsTemplate,
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

type ExtendedConfig = Config<NetworkType> & { projectName: string; projectAbsolutePath: string }

const squidfix = (text: string) => chalk.gray(`[🦑 PIPES SDK] ${text} `)

export class InitHandler {
  private readonly config: ExtendedConfig

  constructor(config: Config<NetworkType>) {
    const pathParts = config.projectFolder.split('/')

    this.config = {
      ...config,
      projectName: pathParts[pathParts.length - 1] ?? config.projectFolder,
      projectAbsolutePath: path.resolve(config.projectFolder),
    }
  }

  async handle(): Promise<void> {
    const spinner = ora('\n\nSetting up new Pipes SDK project...').start()
    try {
      this.checkCurrentProjectPath()

      let contractsMetadata: ContractMetadata[] = []
      if (this.config.contractAddresses.length) {
        spinner.text = squidfix('Fetching contracts metadata')
        contractsMetadata = await new SqdAbiService().getContractData(
          this.config.contractAddresses,
          getEvmChainId(this.config.network),
        )
      }

      const configWithContractMetadata: WithContractMetadata<Config<NetworkType>> = {
        ...this.config,
        contracts: contractsMetadata,
      }

      spinner.text = squidfix('Writing static files')
      this.writeStaticFiles()

      spinner.text = squidfix('Writing template files')
      await this.writeTemplateFiles(configWithContractMetadata)

      spinner.text = squidfix('Copying template contracts')
      await this.copyTemplateContracts()

      spinner.text = squidfix('Installing dependencies')
      await this.installDependencies()

      spinner.text = squidfix('Linting project')
      await this.lintProject()

      if (this.config.contractAddresses.length > 0) {
        spinner.text = squidfix('Generating contract types')
        await this.generateContractTypes()
      }

      if (this.config.sink === 'postgresql') {
        spinner.text = squidfix('Generating database migrations')
        await this.generateDatabaseMigrations()
      }

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
    this.writeToProject('biome.json', biomeConfigTemplate)
    this.writeToProject('tsconfig.json', tsconfigConfigTemplate)
    this.writeToProject('.gitignore', gitignoreTemplate)
    this.writeToProject('AGENTS.md', agentsTemplate)

    if (this.config.packageManager === 'pnpm') {
      this.writeToProject('pnpm-workspace.yaml', pnpmWorkspaceTemplate)
    }
  }

  private async writeTemplateFiles(
    configWithContractMetadata: WithContractMetadata<Config<NetworkType>>,
  ): Promise<void> {
    const { dependencies, devDependencies } = renderDependencies(this.config.sink)
    this.writeToProject(
      'package.json',
      renderPackageJson({
        projectName: this.config.projectName,
        dependencies,
        devDependencies,
        hasPostgresScripts: this.config.sink === 'postgresql',
      }),
    )

    this.writeToProject(
      'Dockerfile',
      renderDockerfile({
        isPostgres: this.config.sink === 'postgresql',
      }),
    )

    this.writeToProject(
      'docker-compose.yml',
      renderDockerCompose({
        projectName: this.config.projectName,
        sink: this.config.sink,
      }),
    )

    this.writeToProject(
      '.env',
      renderEnvTemplate({
        sink: this.config.sink,
      }),
    )

    this.writeToProject(
      'README.md',
      renderReadme({
        packageManager: this.config.packageManager,
        projectName: this.config.projectName,
        hasPostgresScripts: this.config.sink === 'postgresql',
      }),
    )

    this.writeToProject('src/index.ts', await this.renderIndexerTs(configWithContractMetadata))

    if (this.config.sink === 'postgresql') {
      const schemasTs = renderSchemasTemplate(configWithContractMetadata)
      this.writeToProject('src/schemas.ts', schemasTs)
      this.writeToProject('drizzle.config.ts', drizzleConfigTemplate)
      this.writeToProject('src/utils/index.ts', eventEnricherUtilsTemplate)
    }

    if (this.config.sink === 'clickhouse') {
      await this.copyClickHouseMigrations(configWithContractMetadata)
      const content = eventEnricherUtilsTemplate + '\n' + snakeCaseUtilsTemplate
      this.writeToProject('src/utils/index.ts', content)
    }
  }

  private renderIndexerTs(config: WithContractMetadata<Config<NetworkType>>): Promise<string> {
    let builder: TemplateBuilder<NetworkType>
    if (this.config.networkType === 'evm') {
      builder = new EvmTemplateBuilder(config as WithContractMetadata<Config<'evm'>>)
    } else if (this.config.networkType === 'svm') {
      builder = new SvmTemplateBuilder(config as WithContractMetadata<Config<'svm'>>)
    } else {
      throw new InvalidNetworkTypeError(this.config.networkType)
    }

    return builder.build()
  }

  private async installDependencies(): Promise<void> {
    await execAsync(`${this.config.packageManager} install`, {
      cwd: this.config.projectAbsolutePath,
    })
  }

  private async lintProject(): Promise<void> {
    await execAsync(`${this.config.packageManager} run lint`, {
      cwd: this.config.projectAbsolutePath,
    })
  }

  private async generateDatabaseMigrations(): Promise<void> {
    await execAsync(`${this.config.packageManager} run db:generate`, {
      cwd: this.config.projectAbsolutePath,
    })
  }

  private async copyClickHouseMigrations(config: WithContractMetadata<Config<NetworkType>>): Promise<void> {
    const migrationsDir = 'migrations'
    const templateMigrationFile = 'clickhouse-table.sql'
    const templateBaseDir = getTemplateDirname(this.config.networkType)

    for (const template of this.config.templates) {
      if (template.templateId === 'custom') {
        const fileContent = renderCustomClickhouseTables(config)
        this.writeToProject(`${migrationsDir}/custom-contract-migration.sql`, fileContent)
      } else {
        const sourceFile = path.join(templateBaseDir, template.folderName, templateMigrationFile)
        this.copyToProject(sourceFile, `${migrationsDir}/${template.folderName}-migration.sql`)
      }
    }
  }

  private async copyTemplateContracts(): Promise<void> {
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

    for (const template of this.config.templates) {
      const templateContractsDir = path.join(templateBaseDir, template.folderName, 'contracts')
      this.copyToProject(templateContractsDir, 'src/contracts')
    }
  }

  private async generateContractTypes(): Promise<void> {
    const abiService = new SqdAbiService()

    if (this.config.networkType === 'evm') {
      const chainId = getEvmChainId(this.config.network)
      abiService.generateEvmTypes(this.config.projectAbsolutePath, this.config.contractAddresses, chainId)
    } else {
      abiService.generateSolanaTypes(this.config.projectAbsolutePath, this.config.contractAddresses)
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

  private writeToProject(relativePath: string, content: string) {
    const filePath = path.join(this.config.projectAbsolutePath, relativePath)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }

  private copyToProject(absoluteSourcePath: string, relativeTargetPath: string) {
    const absoluteTargetFilePath = path.join(this.config.projectAbsolutePath, relativeTargetPath)

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
