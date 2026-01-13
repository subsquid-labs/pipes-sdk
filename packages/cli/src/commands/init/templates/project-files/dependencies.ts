import type { Sink } from "~/types/init.js"

export const baseDependencies: Record<string, string> = {
  '@subsquid/pipes': '^0.1.0-beta.10',
  '@subsquid/evm-codec': '0.3.0',
  '@subsquid/evm-abi': '0.3.1',
  dotenv: '^16.4.5',
  'better-sqlite3': '^12.5.0',
}

export const baseDevDependencies: Record<string, string> = {
  typescript: '^5.9.2',
  '@biomejs/biome': '^2.3.4',
  tsx: '^4.20.6',
  tsup: '^8.5.0',
  '@types/node': '^22.14.1',
}

export const sinkDependencies: Record<Sink, Record<string, string>> = {
  clickhouse: {
    '@clickhouse/client': '^1.15.0',
  },
  postgresql: {
    'drizzle-kit': '^0.30.0',
    'drizzle-orm': '^0.44.7',
    pg: '^8.16.3',
  },
  memory: {},
}

export function getDependencies(sink: Sink): {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  dependencyNames: string[]
  devDependencyNames: string[]
} {
  const dependencies = { ...baseDependencies, ...sinkDependencies[sink] }
  const devDependencies = { ...baseDevDependencies }

  return {
    dependencies,
    devDependencies,
    dependencyNames: Object.keys(dependencies),
    devDependencyNames: Object.keys(devDependencies),
  }
}
