import { ProjectWriter } from '~/commands/init/init.handler.js'
import { Config, NetworkType, PipeTemplate } from '~/types/init.js'

export abstract class BaseSinkBuilder {
  constructor(protected config: Config<NetworkType>,  protected projectWriter: ProjectWriter) {}

  abstract render(): string

  abstract createMigrations(): Promise<void>

  abstract createEnvFile(): Promise<void>

  abstract getEnvSchema(): string

  // abstract getEnvFile(): string
}
