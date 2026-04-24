import { describe, expect, it } from 'vitest'

import type { Config, NetworkType, PackageManager, Sink } from '~/types/init.js'

import { planConfigFiles } from './plan-config-files.js'

function makeConfig(overrides: Partial<Config<NetworkType>> = {}): Config<NetworkType> {
  return {
    projectFolder: '/tmp/proj',
    networkType: 'evm',
    network: 'ethereum-mainnet',
    templates: [],
    sink: 'clickhouse',
    packageManager: 'pnpm',
    ...overrides,
  }
}

type Slice = {
  packageManager: PackageManager
  sink: Sink
  networkType: NetworkType
}

const slices: Slice[] = [
  { packageManager: 'pnpm', sink: 'clickhouse', networkType: 'evm' },
  { packageManager: 'pnpm', sink: 'postgresql', networkType: 'evm' },
  { packageManager: 'npm', sink: 'clickhouse', networkType: 'evm' },
  { packageManager: 'pnpm', sink: 'clickhouse', networkType: 'svm' },
]

const basePaths = [
  'biome.json',
  'tsconfig.json',
  '.gitignore',
  'AGENTS.md',
  'package.json',
  'Dockerfile',
  'docker-compose.yml',
  'README.md',
  'src/utils/index.ts',
]

function expectedPaths(packageManager: PackageManager): string[] {
  if (packageManager !== 'pnpm') return basePaths
  return [...basePaths.slice(0, 4), 'pnpm-workspace.yaml', ...basePaths.slice(4)]
}

describe('planConfigFiles', () => {
  describe.each(slices)('$packageManager + $sink + $networkType', ({ packageManager, sink, networkType }) => {
    const specs = planConfigFiles(makeConfig({ packageManager, sink, networkType }), 'proj')
    const paths = specs.map((s) => s.path)

    it('returns the expected ordered list of file paths', () => {
      expect(paths).toEqual(expectedPaths(packageManager))
    })

    it('includes pnpm-workspace.yaml iff packageManager is pnpm', () => {
      if (packageManager === 'pnpm') {
        expect(paths).toContain('pnpm-workspace.yaml')
      } else {
        expect(paths).not.toContain('pnpm-workspace.yaml')
      }
    })

    it('does not include drizzle.config.ts', () => {
      expect(paths).not.toContain('drizzle.config.ts')
    })

    it('does not include .env', () => {
      expect(paths).not.toContain('.env')
    })
  })

  describe('package.json snapshots per (packageManager, sink)', () => {
    const pairs: Array<{ packageManager: PackageManager; sink: Sink }> = [
      { packageManager: 'pnpm', sink: 'clickhouse' },
      { packageManager: 'npm', sink: 'clickhouse' },
      { packageManager: 'pnpm', sink: 'postgresql' },
    ]

    it.each(pairs)('matches snapshot for $packageManager + $sink', ({ packageManager, sink }) => {
      const specs = planConfigFiles(makeConfig({ packageManager, sink }), 'proj')
      const pkg = specs.find((s) => s.path === 'package.json')!
      expect(pkg.contents).toMatchSnapshot()
    })
  })

  describe('src/utils/index.ts snapshots per (networkType, sink)', () => {
    const pairs: Array<{ networkType: NetworkType; sink: Sink }> = [
      { networkType: 'evm', sink: 'clickhouse' },
      { networkType: 'evm', sink: 'postgresql' },
      { networkType: 'svm', sink: 'clickhouse' },
    ]

    it.each(pairs)('matches snapshot for $networkType + $sink', ({ networkType, sink }) => {
      const specs = planConfigFiles(makeConfig({ networkType, sink }), 'proj')
      const utils = specs.find((s) => s.path === 'src/utils/index.ts')!
      expect(utils.contents).toMatchSnapshot()
    })
  })

  it('package.json contains postgres drizzle scripts when sink is postgresql', () => {
    const specs = planConfigFiles(makeConfig({ sink: 'postgresql' }), 'proj')
    const pkg = specs.find((s) => s.path === 'package.json')!
    expect(pkg.contents).toContain('"db:migrate": "drizzle-kit migrate"')
  })

  it('package.json omits postgres drizzle scripts when sink is clickhouse', () => {
    const specs = planConfigFiles(makeConfig({ sink: 'clickhouse' }), 'proj')
    const pkg = specs.find((s) => s.path === 'package.json')!
    expect(pkg.contents).not.toContain('"db:migrate": "drizzle-kit migrate"')
  })
})
