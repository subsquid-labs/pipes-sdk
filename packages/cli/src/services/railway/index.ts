import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'

import chalk from 'chalk'

import { Sink } from '~/types/init.js'

import { RailwayNotLoggedInError } from './errors.js'

const execAsync = promisify(exec)

export interface Domain {
  service: string
  domain: string
}

/**
 * A Railway CLI wrapper to improve UX on deploys and other interactions
 * with Pipes SDK projects deployed on the platform
 */
export class RailwayService {
  private static readonly SERVICE_NAME_TEMPLATE = '__SERVICE_NAME__'

  /**
   * Service names
   *
   * Railway requires a name for each serivce define. And we use this service names to
   * refer to other service's environement variables
   */
  private static readonly INDEXER_SERVICE_NAME = 'Pipes'
  private static readonly CLICKHOUSE_SERVICE_NAME = 'Clickhouse'
  private static readonly POSTGRES_SERVICE_NAME = 'Postgres'
  private static readonly PIPE_UI_SERVICE_NAME = 'PipeUI'

  /**
   * Service environment variables
   *
   * Railway variable syntax: ${{ServiceName.VARIABLE_NAME}}
   * Escape $ for shell: \${{ becomes ${{ in the actual command (matches bash script)
   */
  private static readonly PIPE_UI_SERVICE_VARS = [
    RailwayService.withServiceName(
      'METRICS_SERVER_URL=\\${{__SERVICE_NAME__.RAILWAY_PRIVATE_DOMAIN}}:9090',
      RailwayService.INDEXER_SERVICE_NAME,
    ),
  ]
  private static readonly INDEXER_POSTGRES_SERVICE_VARS = [
    RailwayService.withServiceName(
      'DB_CONNECTION_STR=\\${{__SERVICE_NAME__.DATABASE_URL}}',
      RailwayService.POSTGRES_SERVICE_NAME,
    ),
  ]
  private static readonly CLICKHOUSE_SERVICE_VARS = [
    'CLICKHOUSE_DB=pipes',
    'CLICKHOUSE_USER=default',
    'CLICKHOUSE_PASSWORD=password',
  ]
  private static readonly INDEXER_CLICKHOUSE_SERVICE_VARS = [
    RailwayService.withServiceName(
      'CLICKHOUSE_URL=http://\\${{__SERVICE_NAME__.RAILWAY_PRIVATE_DOMAIN}}:8123',
      RailwayService.CLICKHOUSE_SERVICE_NAME,
    ),
    ...RailwayService.CLICKHOUSE_SERVICE_VARS,
  ]

  private static withServiceName(template: string, serviceName: string) {
    return template.replace(RailwayService.SERVICE_NAME_TEMPLATE, serviceName)
  }

  public async isUserLoggedIn(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('railway whoami')
      const username = stdout.trim()
      return username
    } catch {
      throw RailwayNotLoggedInError()
    }
  }

  private async login() {
    await execAsync('railway login')
  }

  public async initProject(projectName: string): Promise<void> {
    await execAsync(`railway init --name "${projectName}"`)
  }

  public async addDatabase(databaseType: Sink): Promise<void> {
    if (databaseType === 'postgresql') {
      await execAsync(`railway add -d postgres`)
    } else if (databaseType === 'clickhouse') {
      await this.execServiceCommand({
        command: 'railway add -s __SERVICE_NAME__ -i clickhouse/clickhouse-server:latest',
        serviceName: RailwayService.CLICKHOUSE_SERVICE_NAME,
        envVars: RailwayService.CLICKHOUSE_SERVICE_VARS,
      })
    } else {
      throw new Error('not implemented')
    }
  }

  public async addIndexerService(githubRepo: string, databaseType: Sink): Promise<void> {
    await this.execServiceCommand({
      command: `railway add -s __SERVICE_NAME__ -r ${githubRepo}`,
      serviceName: RailwayService.INDEXER_SERVICE_NAME,
      envVars: this.getIndexerVariables(databaseType),
    })
  }

  public async addPipeUiService(): Promise<void> {
    await this.execServiceCommand({
      command: `railway add -s __SERVICE_NAME__ -i iankguimaraes/pipe-ui:latest`,
      serviceName: RailwayService.PIPE_UI_SERVICE_NAME,
      envVars: RailwayService.PIPE_UI_SERVICE_VARS,
    })
  }

  // TODO: this should probably be optional
  public async createPublicDomains(databaseType: Sink): Promise<Domain[]> {
    const baseCommand = `railway domain`
    const dbCommand = this.getDbDomainCommand(databaseType)
    const domains = []

    if (dbCommand) {
      domains.push({
        service: databaseType,
        domain: (await dbCommand).stdout,
      })
    }

    domains.push({
      service: RailwayService.PIPE_UI_SERVICE_NAME,
      domain: (
        await this.execServiceCommand({
          command: `${baseCommand} -s __SERVICE_NAME__ -p 3000`,
          serviceName: RailwayService.PIPE_UI_SERVICE_NAME,
        })
      ).stdout,
    })

    return domains.map((d) => ({
      ...d,
      domain: d.domain.replace('Service Domain created:', '').replace(`🚀`, '').replaceAll('\n', ''),
    }))
  }

  /**
   * Open Railway dashboard for this specific project in the browser
   */
  public async openDashboard(): Promise<void> {
    spawn('railway', ['open'], {
      stdio: 'inherit',
      shell: true,
    })
      .on('error', (error) => {
        console.log(chalk.red('✗'), `Failed to open Railway: ${error.message}`)
      })
      .unref()
  }

  private getIndexerVariables(databaseType: Sink): string[] {
    switch (databaseType) {
      case 'clickhouse':
        return RailwayService.INDEXER_CLICKHOUSE_SERVICE_VARS
      case 'postgresql':
        return RailwayService.INDEXER_POSTGRES_SERVICE_VARS
      case 'memory':
        throw new Error('db not supported vars')
    }
  }

  private getDbDomainCommand(databaseType: Sink) {
    const baseCommand = `railway domain`

    switch (databaseType) {
      case 'clickhouse':
        return this.execServiceCommand({
          command: `${baseCommand} -s __SERVICE_NAME__ -p 8123`,
          serviceName: RailwayService.CLICKHOUSE_SERVICE_NAME,
        })
      case 'postgresql':
        return this.execServiceCommand({
          command: `${baseCommand} -s __SERVICE_NAME__ -p 5432`,
          serviceName: RailwayService.POSTGRES_SERVICE_NAME,
        })
      case 'memory':
        return null
    }
  }

  private joinVars(vars: string[]) {
    return vars.map((v) => `-v ${v}`).join(' ')
  }

  private async execServiceCommand({
    command,
    envVars,
    serviceName,
  }: {
    command: string
    envVars?: string[]
    serviceName: string
  }) {
    const withServiceName = RailwayService.withServiceName(command, serviceName)
    return execAsync(envVars ? `${withServiceName} ${this.joinVars(envVars)}` : withServiceName)
  }
}
