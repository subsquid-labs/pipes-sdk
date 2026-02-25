import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

type MetricsServerEntry = {
  url: string
}

type Config = {
  metrics_server_url: MetricsServerEntry[]
}

const DEFAULT_CONFIG: Config = {
  metrics_server_url: [{ url: 'http://localhost:9090' }],
}

export function loadConfig(): Config {
  const configPath = path.resolve(process.cwd(), 'config.yaml')

  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = yaml.load(raw) as Partial<Config>

    return {
      metrics_server_url: parsed?.metrics_server_url ?? DEFAULT_CONFIG.metrics_server_url,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

export type { MetricsServerEntry, Config }
