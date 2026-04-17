import type { Config, NetworkType, Sink } from '~/types/init.js'

import { buildClickhouseSink } from './clickhouse-sink-builder.js'
import { buildPostgresSink } from './postgres-sink-builder.js'
import type { SinkArtifacts, SinkHandler } from './sink-artifacts.js'

export type { SinkArtifacts, SinkFile, SinkHandler, SinkPostStep } from './sink-artifacts.js'
export { buildClickhouseSink } from './clickhouse-sink-builder.js'
export { buildPostgresSink } from './postgres-sink-builder.js'

const handlers: Record<Sink, SinkHandler> = {
  postgresql: buildPostgresSink,
  clickhouse: buildClickhouseSink,
  memory: () => {
    throw new Error('Memory sink is not supported')
  },
}

export function buildSink(config: Config<NetworkType>): SinkArtifacts {
  return handlers[config.sink](config)
}
