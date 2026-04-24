import type { Config, NetworkType } from '~/types/init.js'

export interface SinkFile {
  path: string
  content: string
}

export interface SinkPostStep {
  kind: 'exec'
  command: string
}

export interface SinkArtifacts {
  sinkCode: string
  envSchema: string
  files: SinkFile[]
  postSteps: SinkPostStep[]
}

export type SinkHandler = (config: Config<NetworkType>) => SinkArtifacts
