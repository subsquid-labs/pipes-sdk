import type { ConfiguredTemplate } from '~/commands/init/templates/template.js'

export const packageManagerTypes = [
  { name: 'pnpm', value: 'pnpm', lockFile: 'pnpm-lock.yaml' },
  { name: 'yarn', value: 'yarn', lockFile: 'yarn.lock' },
  { name: 'npm', value: 'npm', lockFile: 'package-lock.json' },
  { name: 'bun', value: 'bun', lockFile: 'bun.lock' },
] as const
export type PackageManager = (typeof packageManagerTypes)[number]['value']

export const networkTypes = [
  { name: 'EVM', value: 'evm' },
  { name: 'SVM', value: 'svm' },
] as const
export type NetworkType = (typeof networkTypes)[number]['value']

export const targetTypes = [
  { name: 'ClickHouse', value: 'clickhouse' },
  { name: 'PostgreSQL', value: 'postgresql' },
] as const
export type Target = (typeof targetTypes)[number]['value']

export interface Config<N extends NetworkType> {
  projectFolder: string
  networkType: N
  /**
   * The network every template indexes. Named "default" because it is the
   * project-wide fallback: when per-deployment networks land, a deployment
   * without an explicit network inherits this one.
   */
  defaultNetwork: string
  templates: ConfiguredTemplate<N, any>[]
  target: Target
  packageManager: PackageManager
}
