import type { Config, NetworkType, PackageManager, Sink } from '~/types/init.js'

import type { InitContext } from '../types.js'
import { FakeProjectWriter } from './fake-project-writer.js'

export type MakeContextOverrides = {
  packageManager?: PackageManager
  sink?: Sink
  networkType?: NetworkType
  network?: string
  projectFolder?: string
  templates?: Config<NetworkType>['templates']
  writer?: FakeProjectWriter
}

export function makeTestContext(overrides: MakeContextOverrides = {}): {
  ctx: InitContext
  writer: FakeProjectWriter
} {
  const writer = overrides.writer ?? new FakeProjectWriter(overrides.projectFolder ?? '/tmp/proj')
  const config: Config<NetworkType> = {
    projectFolder: overrides.projectFolder ?? '/tmp/proj',
    networkType: overrides.networkType ?? 'evm',
    network: overrides.network ?? 'ethereum-mainnet',
    templates: overrides.templates ?? [],
    sink: overrides.sink ?? 'clickhouse',
    packageManager: overrides.packageManager ?? 'pnpm',
  }
  return {
    writer,
    ctx: {
      config,
      projectName: 'proj',
      projectPath: writer.getAbsolutePath(),
      projectWriter: writer.asProjectWriter(),
    },
  }
}
