import { exec, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { promisify } from 'node:util'

import chalk from 'chalk'

import {
  GitHubRemoteNotConfiguredError,
  GitRepositoryNotFoundError,
  PackageJsonNotFoundError,
  PackageNameNotFoundError,
  RailwayNotLoggedInError,
} from './errors.js'

const execAsync = promisify(exec)

interface RailwayDeployConfig {
  packageName: string
  githubRepo: string
  databaseType: string
}

export class RailwayService {
  async deployToRailway(): Promise<void> {
    console.log(chalk.bold('Deploying Pipes SDK project to Railway...'))

    await this.runInitialChecks()
    const config = await this.retrieveValues()
    await this.deploy(config)
  }

  async runInitialChecks(): Promise<void> {
    console.log(chalk.bold('Running initial checks...'))
    console.log('')

    const isGitRepo = await this.checkGitRepo()
    if (!isGitRepo) throw GitRepositoryNotFoundError()
    console.log(chalk.green('✓'), chalk.bold('Git repository'), chalk.gray('found'))

    const remoteUrl = await this.checkGitRemote()
    if (!remoteUrl) throw GitHubRemoteNotConfiguredError()
    console.log(chalk.green('✓'), chalk.bold('GitHub remote'), chalk.gray(`configured: ${chalk.cyan(remoteUrl)}`))

    const railwayUser = await this.checkRailwayLogin()
    if (!railwayUser) throw RailwayNotLoggedInError()
    console.log(
      chalk.green('✓'),
      chalk.bold('Railway login'),
      chalk.gray(`authenticated as ${chalk.cyan(railwayUser)}`),
    )

    console.log('')
  }

  async deploy(config: RailwayDeployConfig): Promise<void> {
    console.log(chalk.bold('Deploying Pipes SDK project to Railway...'))
    console.log(chalk.gray(`  Project name: ${chalk.cyan(config.packageName)}`))
    console.log(chalk.gray(`  GitHub repo: ${chalk.cyan(config.githubRepo)}`))
    console.log(chalk.gray(`  Database: ${chalk.cyan(config.databaseType)}`))
    console.log('')

    console.log(chalk.bold('Initializing Railway project...'))
    await this.initRailwayProject(config.packageName)
    console.log(chalk.green('✓'), chalk.bold('Railway project'), chalk.gray('initialized'))
    console.log('')

    console.log(chalk.bold('Adding database...'))
    await this.addDatabase(config.databaseType)
    console.log(chalk.green('✓'), chalk.bold('Database'), chalk.gray(`added (${chalk.cyan(config.databaseType)})`))
    console.log('')

    console.log(chalk.bold('Adding indexer service...'))
    await this.addIndexerService(config.githubRepo, config.databaseType)
    console.log(chalk.green('✓'), chalk.bold('Indexer service'), chalk.gray('added'))
    console.log('')

    console.log(chalk.green('✓'), chalk.bold('Pipes pipeline deployment setup complete!'))
    console.log('')

    /**
     * We wait because otherwise the Railway will show a 404 page, which resolves
     * automatically after a few seconds but not a great UX
     */
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await this.openRailwayUI()
  }

  async checkGitRepo(): Promise<boolean> {
    try {
      // Suppress output by redirecting to null device
      const command =
        process.platform === 'win32' ? 'git rev-parse --git-dir > nul 2>&1' : 'git rev-parse --git-dir > /dev/null 2>&1'
      await execAsync(command)
      return true
    } catch {
      return false
    }
  }

  async checkGitRemote(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git remote get-url origin')
      const remoteUrl = stdout.trim()
      return remoteUrl
    } catch {
      return null
    }
  }

  async checkRailwayLogin(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('railway whoami')
      const username = stdout.trim()
      return username
    } catch {
      return null
    }
  }

  /**
   * Get package name from package.json
   */
  getPackageName(): string {
    if (!existsSync('package.json')) {
      throw PackageJsonNotFoundError()
    }

    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'))
    const packageName = packageJson.name

    if (!packageName) {
      throw PackageNameNotFoundError()
    }

    console.log(chalk.green('✓'), chalk.bold('Package name'), chalk.gray(`extracted: ${chalk.cyan(packageName)}`))
    return packageName
  }

  /**
   * Extract GitHub repo from git remote URL
   * Supports various formats:
   * - git@github.com:user/repo.git -> user/repo
   * - https://github.com/user/repo.git -> user/repo
   * - https://github.com/user/repo -> user/repo
   */
  extractGitHubRepo(remoteUrl: string): string {
    // Match github.com followed by : or /, then capture user/repo
    const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
    if (!match) {
      console.log(`Could not extract GitHub repo from remote URL: ${remoteUrl}`)
      throw new Error(`Invalid GitHub remote URL: ${remoteUrl}`)
    }

    const repo = match[1].replace(/\.git$/, '')
    console.log(chalk.green('✓'), chalk.bold('GitHub repository'), chalk.gray(`extracted: ${chalk.cyan(repo)}`))
    return repo
  }

  /**
   * Check for drizzle.config.ts to determine database type
   */
  checkDrizzleConfig(): string {
    if (existsSync('drizzle.config.ts')) {
      console.log(
        chalk.green('✓'),
        chalk.bold('Database type'),
        chalk.gray(`detected: ${chalk.cyan('postgres')} (from drizzle.config.ts)`),
      )
      return 'postgres'
    } else {
      console.log(
        chalk.yellow('!'),
        chalk.bold('Database type'),
        chalk.gray(`defaulting to ${chalk.cyan('postgres')} (drizzle.config.ts not found)`),
      )
      return 'postgres'
    }
  }

  /**
   * Retrieve all configuration values needed for deployment
   */
  async retrieveValues(): Promise<RailwayDeployConfig> {
    console.log(chalk.bold('Retrieving configuration values...'))
    console.log('')

    const packageName = this.getPackageName()
    const remoteUrl = await this.checkGitRemote()
    if (!remoteUrl) throw new Error('No GitHub remote configured')

    const githubRepo = this.extractGitHubRepo(remoteUrl)
    const databaseType = this.checkDrizzleConfig()

    console.log('')
    return {
      packageName,
      githubRepo,
      databaseType,
    }
  }

  async initRailwayProject(projectName: string): Promise<void> {
    await execAsync(`railway init --name "${projectName}"`)
  }

  async addDatabase(databaseType: string): Promise<void> {
    await execAsync(`railway add -d ${databaseType}`)
  }

  async addIndexerService(githubRepo: string, databaseType: string): Promise<void> {
    const dbVarName = databaseType === 'postgres' ? 'Postgres' : databaseType
    /*
     * Railway variable syntax: ${{ServiceName.VARIABLE_NAME}}
     * Escape $ for shell: \${{ becomes ${{ in the actual command (matches bash script)
     */
    const envVar = 'DB_CONNECTION_STR=\\${{' + dbVarName + '.DATABASE_URL}}'
    await execAsync(`railway add -s indexer -r ${githubRepo} -v "${envVar}"`)
  }

  /**
   * Open Railway dashboard in browser
   */
  async openRailwayUI(): Promise<void> {
    console.log('Opening Railway dashboard in browser...')

    spawn('railway', ['open'], {
      stdio: 'inherit',
      shell: true,
    })
      .on('error', (error) => {
        console.log(chalk.red('✗'), `Failed to open Railway: ${error.message}`)
      })
      .unref()
  }
}
