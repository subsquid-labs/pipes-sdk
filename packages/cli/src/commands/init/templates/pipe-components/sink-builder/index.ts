import { Config, NetworkType } from '~/types/init.js'
import { BaseSinkBuilder } from './base-sink-builder.js'
import { ClickhouseSinkBuilder } from './clickhouse-sink-builder.js'
import { PostgresSinkBuilder } from './postgres-sink-builder.js'
import { ProjectWriter } from '~/commands/init/init.handler.js'

export class SinkBuilder {
  private sinkBuilder: BaseSinkBuilder

  constructor(config: Config<NetworkType>, projectWriter: ProjectWriter) {
    switch (config.sink) {
      case 'postgresql':
        this.sinkBuilder = new PostgresSinkBuilder(config, projectWriter)
        break
      case 'clickhouse':
        this.sinkBuilder = new ClickhouseSinkBuilder(config, projectWriter)
        break
      case 'memory':
        throw new Error('Memory sink template not implemeted')
    }
  }

  render() {
    return this.sinkBuilder.render()
  }

  getEnvSchema(): string {
    return this.sinkBuilder.getEnvSchema()
  }

  createMigrations(): Promise<void> {
    return this.sinkBuilder.createMigrations()
  }

  createEnvFile(): Promise<void> {
    return this.sinkBuilder.createEnvFile()
  }
}
