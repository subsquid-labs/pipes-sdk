import { existsSync, readFileSync } from 'fs'

import { Sink } from '~/types/init.js'

import { PackageJsonNotFoundError, PackageNameNotFoundError } from './errors.js'

// TODO: fetch db secrets from .env
// TODO: let the user define a custome deploy.config.yaml file
export class ProjectService {
  public getName(): string {
    if (!existsSync('package.json')) {
      throw PackageJsonNotFoundError()
    }

    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'))
    const packageName = packageJson.name

    if (!packageName) {
      throw PackageNameNotFoundError()
    }

    return packageName
  }

  /**
   * TODO: this heuristic fails if the user has no database configured
   * should find a different approach
   */
  public getSinkType(): Sink {
    if (existsSync('drizzle.config.ts')) {
      return 'postgresql'
    } else {
      return 'clickhouse'
    }
  }
}
