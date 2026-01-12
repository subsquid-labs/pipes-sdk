import { exec } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import chalk from 'chalk'
import ora from 'ora'
import { z } from 'zod'
import { getEvmChainId } from '~/config/networks.js'
import { SqdAbiService } from '~/services/sqd-abi.js'
import { templates } from '~/template/index.js'
import { EvmTemplateBuilder } from '~/template/pipes/evm/evm-template-builder.js'
import { renderSchemasTemplate } from '~/template/pipes/evm/schemas-template.js'
import { SolanaTemplateBuilder } from '~/template/pipes/svm/solana-template-builder.js'
import {
  biomeConfig,
  clickhouseUtilsTemplate,
  drizzleConfigTemplate,
  getDependencies,
  getDockerCompose,
  getEnvTemplate,
  gitignoreContent,
  pnpmWorkspace,
  renderPackageJson,
  tsconfigConfig,
} from '~/template/scaffold/index.js'
import type { Config } from '~/types/config.js'
import type { NetworkType } from '~/types/network.js'
import { findPackageRoot } from '~/utils/package-root.js'

const execAsync = promisify(exec)

const configJsonSchema = z.object({
  projectFolder: z.string().min(1),
  chainType: z.enum(['evm', 'svm']),
  network: z.string().min(1),
  pipelineMode: z.enum(['templates', 'custom']),
  templates: z.array(z.string()),
  contractAddresses: z.array(z.string()),
  sink: z.enum(['clickhouse', 'postgresql', 'memory']),
})

const squidfix = (text: string) => `[🦑 PIPES SDK] ${text} `

type ConfigJson = z.infer<typeof configJsonSchema>

export class InitHandler {
  constructor(private readonly config: Config<NetworkType>) {}

  async handle(): Promise<void> {
    const spinner = ora('Setting up new Pipes SDK project...').start()
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

      spinner.succeed(`${squidfix(this.config.projectFolder)} project initialized successfully`)

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
    writeFileSync(path.join(projectPath, 'biome.json'), JSON.stringify(biomeConfig, null, 2))

    writeFileSync(path.join(projectPath, 'tsconfig.json'), JSON.stringify(tsconfigConfig, null, 2))

    writeFileSync(path.join(projectPath, '.gitignore'), gitignoreContent)

    writeFileSync(path.join(projectPath, 'docker-compose.yml'), getDockerCompose(this.config.sink))

    writeFileSync(path.join(projectPath, '.env'), getEnvTemplate(this.config.sink))

    writeFileSync(path.join(projectPath, 'pnpm-workspace.yaml'), pnpmWorkspace)
  }

  private writeTemplateFiles(projectPath: string): void {
    const { dependencies, devDependencies } = getDependencies(this.config.sink)
    const packageJson = renderPackageJson(
      this.config.projectFolder,
      dependencies,
      devDependencies,
      this.config.sink === 'postgresql',
    )
    writeFileSync(path.join(projectPath, 'package.json'), packageJson)

    const indexTs = this.buildIndexTs()
    writeFileSync(path.join(projectPath, 'src/index.ts'), indexTs)

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

  private buildIndexTs(): string {
    if (this.config.networkType === 'evm') {
      const builder = new EvmTemplateBuilder(this.config as Config<'evm'>)
      return builder.build()
    }
    if (this.config.networkType === 'svm') {
      const builder = new SolanaTemplateBuilder(this.config as Config<'svm'>)
      return builder.build()
    }

    throw new Error('Invalid chain type')
  }

  private async installDependencies(projectPath: string): Promise<void> {
    await execAsync('pnpm install', {
      cwd: projectPath,
    })
  }

  private async lintProject(projectPath: string): Promise<void> {
    await execAsync('pnpm lint', {
      cwd: projectPath,
    })
  }

  private async generateDatabaseMigrations(projectPath: string): Promise<void> {
    await execAsync('pnpm db:generate', {
      cwd: projectPath,
    })
  }

  private async copyClickHouseMigrations(projectPath: string): Promise<void> {
    const packageRoot = findPackageRoot()
    // Try dist/template first (for bundled builds), then fall back to src/template
    const distTemplateDir = path.join(packageRoot, 'dist', 'template', 'pipes', this.config.networkType)
    const srcTemplateDir = path.join(packageRoot, 'src', 'template', 'pipes', this.config.networkType)
    const templateBaseDir = existsSync(distTemplateDir) ? distTemplateDir : srcTemplateDir

    const migrationsDir = path.join(projectPath, 'src/migrations')
    await mkdir(migrationsDir, { recursive: true })

    const templateEntries = Object.entries(this.config.templates)

    for (const [templateId] of templateEntries) {
      const sourceFile = path.join(templateBaseDir, templateId, 'clickhouse-table.sql')

      if (existsSync(sourceFile)) {
        const targetFile = path.join(migrationsDir, `${templateId}-migration.sql`)
        copyFileSync(sourceFile, targetFile)
      }
    }

    // Handle custom contract template if present
    if (this.config.contractAddresses.length > 0) {
      const customContractSourceFile = path.join(templateBaseDir, 'custom-contract', 'clickhouse-table.sql')

      if (existsSync(customContractSourceFile)) {
        const targetFile = path.join(migrationsDir, 'custom-contract-migration.sql')
        copyFileSync(customContractSourceFile, targetFile)
      }
    }
  }

  private async copyTemplateContracts(projectPath: string): Promise<void> {
    const packageRoot = findPackageRoot()
    // Try dist/template first (for bundled builds), then fall back to src/template
    const distTemplateDir = path.join(packageRoot, 'dist', 'template', 'pipes', this.config.networkType)
    const srcTemplateDir = path.join(packageRoot, 'src', 'template', 'pipes', this.config.networkType)
    const templateBaseDir = existsSync(distTemplateDir) ? distTemplateDir : srcTemplateDir

    const templateEntries = Object.entries(this.config.templates)
    let hasContracts = false

    for (const [templateId] of templateEntries) {
      const templateContractsDir = path.join(templateBaseDir, templateId, 'contracts')

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

    for (const [templateId] of templateEntries) {
      const templateContractsDir = path.join(templateBaseDir, templateId, 'contracts')

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
    const sep = '─'.repeat(64)
    const pathLine = `📁 Project created in ${projectPath}`

    console.log(`\n${sep}`)

    console.log(`${pathLine}\n`)

    console.log('Next steps\n')

    console.log(`1) Enter the folder`)
    console.log(`   ${chalk.bold(`cd ${projectPath}`)}\n`)

    console.log(`2) Start your database (Docker)`)
    console.log(`   ${chalk.bold('docker compose up -d')}\n`)

    if (this.config.sink === 'postgresql') {
      console.log(`3) Apply migrations`)
      console.log(`   ${chalk.bold('pnpm db:migrate')}\n`)

      console.log(`4) Start the pipeline`)
      console.log(`   ${chalk.bold('pnpm dev')}\n`)
    } else if (this.config.sink === 'clickhouse') {
      console.log(`3) Start the pipeline`)
      console.log(`   ${chalk.bold('pnpm dev')}\n`)
    } else {
      console.log(`3) Start the pipeline`)
      console.log(`   ${chalk.bold('pnpm dev')}\n`)
    }
    console.log(
      chalk.dim(
        `Need help? Check our documentation at ${chalk.bold.underline('https://beta.docs.sqd.dev/en/sdk/pipes-sdk')}`,
      ),
    )
    console.log(`${sep}\n`)
  }
  static fromJson(jsonString: string): InitHandler {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonString)
    } catch (error) {
      throw new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`)
    }

    const validated = configJsonSchema.parse(parsed)
    const config = InitHandler.transformToConfig(validated)
    return new InitHandler(config)
  }

  private static transformToConfig(json: ConfigJson): Config<NetworkType> {
    const { chainType, pipelineMode, templates: templateIds, contractAddresses, ...rest } = json

    let templateMap: Config<NetworkType>['templates']

    if (pipelineMode === 'templates') {
      if (chainType === 'evm') {
        templateMap = templateIds.reduce<Config<'evm'>['templates']>((acc: Config<'evm'>['templates'], id: string) => {
          if (id in templates.evm) {
            acc[id as keyof typeof templates.evm] = templates.evm[id as keyof typeof templates.evm]
          }
          return acc
        }, {})
      } else {
        templateMap = templateIds.reduce<Config<'svm'>['templates']>((acc: Config<'svm'>['templates'], id: string) => {
          if (id in templates.svm) {
            acc[id as keyof typeof templates.svm] = templates.svm[id as keyof typeof templates.svm]
          }
          return acc
        }, {})
      }
    } else {
      if (chainType === 'evm') {
        templateMap = { custom: templates.evm.custom } as Config<'evm'>['templates']
      } else {
        templateMap = { custom: templates.svm.custom } as Config<'svm'>['templates']
      }
    }

    return {
      ...rest,
      networkType: chainType,
      templates: templateMap,
      contractAddresses,
    } as Config<NetworkType>
  }
}
