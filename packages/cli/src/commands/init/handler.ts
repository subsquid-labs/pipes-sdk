import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Mustache from 'mustache'
import { renderSchemasTemplate } from '~/template/evm/schemas-template.js'
import { renderStarterTemplate } from '~/template/evm/starter.js'
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
} from '~/template/project/index.js'
import type { NetworkType } from '~/types/network.js'
import { getEvmChainId } from '../../config/networks.js'
import { SqdAbiService } from '../../services/sqd-abi.js'
import type { Config } from '../../types/config.js'

export class InitHandler {
  constructor(private readonly config: Config<NetworkType>) {}

  async handle(): Promise<void> {
    await this.createProjectFolder(this.config.projectFolder)
    await this.scaffoldProject()
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

  private async scaffoldProject(): Promise<void> {
    const projectPath = path.resolve(this.config.projectFolder)

    await mkdir(path.join(projectPath, 'src'), { recursive: true })

    this.writeStaticFiles(projectPath)

    this.writeTemplateFiles(projectPath)

    await this.copyTemplateContracts(projectPath)

    this.installDependencies(projectPath)

    this.lintProject(projectPath)

    if (this.config.contractAddresses.length > 0) {
      await this.generateContractTypes(projectPath)
    }
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

    const indexTs = renderStarterTemplate(this.config)
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

  private installDependencies(projectPath: string): void {
    const { dependencies, devDependencies } = getDependencies(this.config.sink)

    console.log('Installing dependencies...')

    if (dependencies.length > 0) {
      execSync(`pnpm add ${dependencies.join(' ')}`, {
        cwd: projectPath,
        stdio: 'inherit',
      })
    }

    if (devDependencies.length > 0) {
      execSync(`pnpm add -D ${devDependencies.join(' ')}`, {
        cwd: projectPath,
        stdio: 'inherit',
      })
    }

    console.log('Dependencies installed successfully!')
  }

  private lintProject(projectPath: string): void {
    console.log('Linting project...')
    execSync(`pnpm lint`, {
      cwd: projectPath,
      stdio: 'ignore',
    })
    console.log('Linting completed successfully!')
  }

  private async copyTemplateContracts(projectPath: string): Promise<void> {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    const templateBaseDir = path.join(__dirname, '..', '..', 'template', this.config.chainType)

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
    console.log('Generating contract types...')

    await mkdir(path.join(projectPath, 'src/contracts'), { recursive: true })

    const abiService = new SqdAbiService()

    if (this.config.chainType === 'evm') {
      const chainId = getEvmChainId(this.config.network)
      if (!chainId) {
        console.warn(`Warning: Could not find chainId for ${this.config.network}`)
        return
      }
      abiService.generateEvmTypes(projectPath, this.config.contractAddresses, chainId)
    } else {
      abiService.generateSolanaTypes(projectPath, this.config.contractAddresses)
    }

    console.log('Contract types generated successfully!')
  }
}
