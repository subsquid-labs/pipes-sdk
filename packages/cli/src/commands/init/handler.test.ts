import { readFileSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { templates } from '~/template/index.js'
import { Config } from '~/types/config.js'
import { InitHandler } from './handler.js'

async function exists(p: string) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function isDir(p: string) {
  const st = await stat(p)
  return st.isDirectory()
}

async function isFile(p: string) {
  const st = await stat(p)
  return st.isFile()
}

describe('InitHandler', () => {
  let tmpRoot: string
  let projectDir: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'my-cli-'))
    projectDir = path.join(tmpRoot, 'my-project')
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('creates expected base folder structure', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: {
        'erc20-transfers': templates.evm['erc20-transfers'],
      },
      contractAddresses: [],
      sink: 'clickhouse',
    }

    await new InitHandler(config).handle()

    await expect(exists(projectDir)).resolves.toBe(true)
    await expect(isDir(projectDir)).resolves.toBe(true)
    await expect(isDir(path.join(projectDir, 'src'))).resolves.toBe(true)
    await expect(isDir(path.join(projectDir, 'node_modules'))).resolves.toBe(true)
  })

  it('creates project base files', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: {
        'erc20-transfers': templates.evm['erc20-transfers'],
      },
      contractAddresses: [],
      sink: 'clickhouse',
    }

    await new InitHandler(config).handle()

    await expect(isFile(path.join(projectDir, 'package.json'))).resolves.toBe(true)
    await expect(isFile(path.join(projectDir, 'biome.json'))).resolves.toBe(true)
    await expect(isFile(path.join(projectDir, 'tsconfig.json'))).resolves.toBe(true)
    await expect(isFile(path.join(projectDir, '.env'))).resolves.toBe(true)
    await expect(isFile(path.join(projectDir, '.gitignore'))).resolves.toBe(true)
    await expect(isFile(path.join(projectDir, 'pnpm-lock.yaml'))).resolves.toBe(true)
  })

  it('creates project specific folders and files for clickhouse sink', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: {
        'erc20-transfers': templates.evm['erc20-transfers'],
      },
      contractAddresses: [],
      sink: 'clickhouse',
    }

    await new InitHandler(config).handle()

    await expect(isDir(path.join(projectDir, 'src/migrations'))).resolves.toBe(true)
    const dockerComposePath = path.join(projectDir, 'docker-compose.yml')
    await expect(isFile(dockerComposePath)).resolves.toBe(true)
    expect(readFileSync(dockerComposePath, 'utf8')).toMatchInlineSnapshot(`
      "services:
        clickhouse:
          image: clickhouse/clickhouse-server:latest
          ports:
            - "8123:8123"
          environment:
            CLICKHOUSE_DB: pipes
            CLICKHOUSE_USER: default
            CLICKHOUSE_PASSWORD: password
      "
    `)
  })

  it('creates project specific folders and files for postgresql sink', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: {
        'erc20-transfers': templates.evm['erc20-transfers'],
      },
      contractAddresses: [],
      sink: 'postgresql',
    }

    await new InitHandler(config).handle()

    await expect(isDir(path.join(projectDir, 'migrations'))).resolves.toBe(true)
    await expect(isFile(path.join(projectDir, 'src/schemas.ts'))).resolves.toBe(true)
    const dockerComposePath = path.join(projectDir, 'docker-compose.yml')
    await expect(isFile(dockerComposePath)).resolves.toBe(true)
    expect(readFileSync(dockerComposePath, 'utf8')).toMatchInlineSnapshot(`
      "services:
        postgres:
          image: postgres:latest
          environment:
            POSTGRES_USER: postgres
            POSTGRES_PASSWORD: password
            POSTGRES_DB: pipes
          ports:
            - "5432:5432"
          healthcheck:
            test: ["CMD-SHELL", "pg_isready -U postgres"]
            interval: 10s
            timeout: 5s
            retries: 5
      "
    `)
  })
})
