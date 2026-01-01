import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import chalk from 'chalk'
import Mustache from 'mustache'
import ora from 'ora'
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
  packageJsonTemplate,
  tsconfigConfig,
} from '~/template/scaffold/index.js'
import type { NetworkType } from '~/types/network.js'
import { getEvmChainId } from '../../config/networks.js'
import { SqdAbiService } from '../../services/sqd-abi.js'
import type { Config } from '../../types/config.js'

export class InitHandler {
  constructor(private readonly config: Config<NetworkType>) {}

  async handle(): Promise<void> {
    const spinner = ora('Setting up new Pipes SDK project...').start()
    try {
      spinner.text = 'Creating project folder'
      await this.createProjectFolder(this.config.projectFolder)

      const projectPath = path.resolve(this.config.projectFolder)

      await mkdir(path.join(projectPath, 'src'), { recursive: true })

      this.writeStaticFiles(projectPath)

      this.writeTemplateFiles(projectPath)

      if (this.config.sink === 'clickhouse') {
        await this.copyClickHouseMigrations(projectPath)
      }

      await this.copyTemplateContracts(projectPath)

      this.installDependencies(projectPath)

      this.lintProject(projectPath)

      if (this.config.contractAddresses.length > 0) {
        await this.generateContractTypes(projectPath)
      }

      if (this.config.sink === 'postgresql') {
        spinner.text = 'Generating database migrations'
        await new Promise(resolve => setImmediate(resolve))
        this.generateDatabaseMigrations(projectPath)
      }

      spinner.succeed(`${this.config.projectFolder} project initialized successfully`)

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
  }

  private writeTemplateFiles(projectPath: string): void {
    const packageJson = Mustache.render(packageJsonTemplate, {
      projectName: this.config.projectFolder,
      hasPostgresScripts: this.config.sink === 'postgresql',
    })
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
    if (this.config.chainType === 'evm') {
      const builder = new EvmTemplateBuilder(this.config as Config<'evm'>)
      return builder.build()
    }
    if (this.config.chainType === 'svm') {
      const builder = new SolanaTemplateBuilder(this.config as Config<'svm'>)
      return builder.build()
    }

    throw new Error('Invalid chain type')
  }

  private installDependencies(projectPath: string): void {
    const { dependencies, devDependencies } = getDependencies(this.config.sink)

    if (dependencies.length > 0) {
      execSync(`pnpm add ${dependencies.join(' ')}`, {
        cwd: projectPath,
        stdio: 'ignore',
      })
    }

    if (devDependencies.length > 0) {
      execSync(`pnpm add -D ${devDependencies.join(' ')}`, {
        cwd: projectPath,
        stdio: 'ignore',
      })
    }
  }

  private lintProject(projectPath: string): void {
    execSync(`pnpm lint`, {
      cwd: projectPath,
      stdio: 'ignore',
    })
  }

  private generateDatabaseMigrations(projectPath: string): void {
    execSync(`pnpm db:generate`, {
      cwd: projectPath,
      stdio: 'ignore',
    })
  }

  private async copyClickHouseMigrations(projectPath: string): Promise<void> {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const templateBaseDir = path.join(__dirname, '..', '..', 'template', 'pipes', this.config.chainType)

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
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const templateBaseDir = path.join(__dirname, '..', '..', 'template', 'pipes', this.config.chainType)

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

    if (this.config.chainType === 'evm') {
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
  
    const cmd = (s: string) => `\x1b[1m${s}\x1b[0m` // bold
    const hint = (s: string) => `\x1b[2m${s}\x1b[0m` // dim
  
    console.log(`\n${sep}`)

    console.log(`${pathLine}\n`)
  
    console.log('Next steps\n')
  
    console.log(`1) Enter the folder`)
    console.log(`   ${cmd(`cd ${projectPath}`)}\n`)
  
    console.log(`2) Start your database (Docker)`)
    console.log(`   ${cmd('docker compose up -d')}\n`)
  
    if (this.config.sink === 'postgresql') {
      console.log(`3) Apply migrations`)
      console.log(`   ${cmd('pnpm db:migrate')}\n`)
  
      console.log(`4) Start the pipeline`)
      console.log(`   ${cmd('pnpm dev')}\n`)
    } else if (this.config.sink === 'clickhouse') {
      console.log(`3) Start the pipeline`)
      console.log(`   ${cmd('pnpm dev')}\n`)
    } else {
      console.log(`3) Start the pipeline`)
      console.log(`   ${cmd('pnpm dev')}\n`)
    }
    console.log(chalk.dim(`Need help? Check our documentation at ${chalk.bold.underline('https://beta.docs.sqd.dev/en/sdk/pipes-sdk')}`))
    console.log(`${sep}\n`)
  }
}
