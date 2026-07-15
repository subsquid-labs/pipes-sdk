import type { Config, NetworkType, Target } from '~/types/init.js'

import { buildClickhouseTarget } from './clickhouse-target-builder.js'
import { buildPostgresTarget } from './postgres-target-builder.js'
import type { TargetArtifacts, TargetHandler } from './target-artifacts.js'

export { buildClickhouseTarget } from './clickhouse-target-builder.js'
export { buildPostgresTarget } from './postgres-target-builder.js'
export type { TargetArtifacts, TargetFile, TargetHandler, TargetPostStep } from './target-artifacts.js'

const handlers: Record<Target, TargetHandler> = {
  postgresql: buildPostgresTarget,
  clickhouse: buildClickhouseTarget,
}

export function buildTarget(config: Config<NetworkType>): TargetArtifacts {
  const handler = handlers[config.target]
  if (!handler) {
    throw new Error(`Unknown target "${config.target}". Supported targets: ${Object.keys(handlers).join(', ')}.`)
  }

  return handler(config)
}
