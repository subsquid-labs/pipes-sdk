import type { Config, NetworkType } from '~/types/init.js'

export interface TargetFile {
  path: string
  content: string
}

export interface TargetPostStep {
  kind: 'exec'
  command: string
}

export interface TargetArtifacts {
  sinkCode: string
  envSchema: string
  files: TargetFile[]
  postSteps: TargetPostStep[]
}

export type TargetHandler = (config: Config<NetworkType>) => TargetArtifacts
