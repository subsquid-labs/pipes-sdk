import chalk from 'chalk'

import { GitService } from '~/services/git/index.js'
import { ProjectService } from '~/services/project/index.js'
import { RailwayService } from '~/services/railway/index.js'
import { Sink } from '~/types/init.js'
import { CliStep } from '~/utils/cli-step.js'

import { ProviderDeployHandler } from './provider.handler.js'

interface RailwayDeployConfig {
  packageName: string
  githubRepo: string
  databaseType: Sink
}

export class RailwayDeployHandler implements ProviderDeployHandler {
  private gitService: GitService
  private railwayService: RailwayService
  private projectService: ProjectService

  constructor() {
    this.gitService = new GitService()
    this.railwayService = new RailwayService()
    this.projectService = new ProjectService()
  }

  async deploy() {
    await this.runInitialChecks()
    const deployConfig = await this.getDeployConfig()
    await this.deployProject(deployConfig)
    /**
     * We wait because otherwise the Railway will show a 404 page, which resolves
     * automatically after a few seconds but not a great UX
     */
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await this.railwayService.openDashboard()
  }

  private async runInitialChecks(): Promise<void> {
    const cliStep = new CliStep('Running inital checks')

    await cliStep.step('Checking repo initialization', () => this.gitService.isGitRepo())
    await cliStep.step('Verifying git remote', () => this.gitService.getRemoteUrl())
    await cliStep.step('Is user authenticated with Railway', () => this.railwayService.isUserLoggedIn())

    cliStep.finalMessage('Environment ready to deploy')
  }

  private async getDeployConfig(): Promise<RailwayDeployConfig> {
    const cliStep = new CliStep('Extracting configuration values...')

    const packageName = await cliStep.step('Fetching package name', () => this.projectService.getName())
    const databaseType = await cliStep.step('Inferring database from config', () => this.projectService.getSinkType())
    const githubRepo = await cliStep.step('Extracting GitHub repo from remote', () => this.gitService.getGithubRepo())

    cliStep.finalMessage(
      [
        chalk.bold('Found the following config: '),
        chalk.gray(`  Project name: ${chalk.cyan(packageName)}`),
        chalk.gray(`  GitHub repo: ${chalk.cyan(githubRepo)}`),
        chalk.gray(`  Database: ${chalk.cyan(databaseType)}`),
      ].join('\n'),
    )

    return {
      packageName,
      githubRepo,
      databaseType,
    }
  }

  private async deployProject(config: RailwayDeployConfig) {
    const cliStep = new CliStep('Running inital checks')

    await cliStep.step('Initializing Railway project', () => this.railwayService.initProject(config.packageName))
    await cliStep.step(`Adding ${config.databaseType} service`, () =>
      this.railwayService.addDatabase(config.databaseType),
    )
    await cliStep.step('Adding indexer service', () =>
      this.railwayService.addIndexerService(config.githubRepo, config.databaseType),
    )
    await cliStep.step('Adding Pipe UI service', () => this.railwayService.addPipeUiService())
    const domains = await cliStep.step('Generating public domains', () =>
      this.railwayService.createPublicDomains(config.databaseType),
    )

    cliStep.finalMessage(
      [
        chalk.bold('Pipes pipeline deployment setup complete!'),
        '',
        'The following components are available through their public domains:',
        domains.map((d) => `- ${chalk.yellow(d.service)}: ${chalk.underline.cyan(d.domain)}`).join('\n'),
        '',
        chalk.gray(`You can now menage the project deployment using Railway CLI or through the dashborad`),
        '',
        'Opening Railway dashboard in browser...',
      ].join('\n'),
    )
  }
}
