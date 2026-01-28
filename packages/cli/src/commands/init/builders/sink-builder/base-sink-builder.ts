import { ProjectWriter } from '~/utils/project-writer.js'
import { Config, NetworkType } from '~/types/init.js'

export abstract class BaseSinkBuilder {
  constructor(protected config: Config<NetworkType>,  protected projectWriter: ProjectWriter) {}

  abstract render(): string

  abstract createMigrations(): Promise<void>

  abstract createEnvFile(): void

  abstract getEnvSchema(): string

  // abstract getEnvFile(): string
}
