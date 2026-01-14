import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evmTemplates } from '~/commands/init/templates/pipe-templates/evm/index.js'
import { Config } from '~/types/init.js'
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

function fileContent(p: string) {
  return readFile(p, 'utf8')
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
      templates: [evmTemplates['erc20Transfers']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'pnpm',
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
      templates: [evmTemplates['erc20Transfers']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    await new InitHandler(config).handle()

    const filesInRoot = await readdir(projectDir)

    expect(filesInRoot).toEqual(
      expect.arrayContaining(['package.json', 'biome.json', 'tsconfig.json', '.env', '.gitignore', 'pnpm-lock.yaml']),
    )
  })

  it('creates project specific folders and files for clickhouse sink', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates['erc20Transfers']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    await new InitHandler(config).handle()

    const packageJsonContent = await fileContent(path.join(projectDir, 'package.json'))
    expect(packageJsonContent).to.not.include('"db:generate": "drizzle-kit generate"')
    expect(packageJsonContent).to.not.include('"db:migrate": "drizzle-kit migrate"')
    expect(packageJsonContent).to.not.include('"db:push": "drizzle-kit push"')

    await expect(isDir(path.join(projectDir, 'src/migrations'))).resolves.toBe(true)
    const dockerComposePath = path.join(projectDir, 'docker-compose.yml')
    await expect(isFile(dockerComposePath)).resolves.toBe(true)
    await expect(fileContent(dockerComposePath)).resolves.toMatchInlineSnapshot(`
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

      templates: [evmTemplates['erc20Transfers']],
      contractAddresses: [],
      sink: 'postgresql',
      packageManager: 'pnpm',
    }

    await new InitHandler(config).handle()

    const packageJsonContent = await fileContent(path.join(projectDir, 'package.json'))
    expect(packageJsonContent).to.include('"db:generate": "drizzle-kit generate"')
    expect(packageJsonContent).to.include('"db:migrate": "drizzle-kit migrate"')
    expect(packageJsonContent).to.include('"db:push": "drizzle-kit push"')

    await expect(isDir(path.join(projectDir, 'migrations'))).resolves.toBe(true)
    await expect(isFile(path.join(projectDir, 'src/schemas.ts'))).resolves.toBe(true)

    const dockerComposePath = path.join(projectDir, 'docker-compose.yml')
    await expect(isFile(dockerComposePath)).resolves.toBe(true)
    await expect(fileContent(dockerComposePath)).resolves.toMatchInlineSnapshot(`
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

  it('generates additional folders from pipe templates', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates['uniswapV3Swaps']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    await new InitHandler(config).handle()

    const contractsDir = path.join(projectDir, 'src/contracts')
    await expect(isDir(contractsDir)).resolves.toBe(true)

    const filesInContractsDir = await readdir(contractsDir)
    expect(filesInContractsDir).toEqual(expect.arrayContaining(['factory.ts', 'pool.ts']))
  })

  it('install dependencies using pnpm as package manager', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates['erc20Transfers']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'pnpm',
    }

    await new InitHandler(config).handle()

    await expect(isFile(path.join(projectDir, 'pnpm-lock.yaml'))).resolves.toBe(true)
  })

  it('install dependencies using yarn as package manager', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates['erc20Transfers']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'yarn',
    }

    await new InitHandler(config).handle()

    await expect(isFile(path.join(projectDir, 'yarn.lock'))).resolves.toBe(true)
  })

  it('install dependencies using bun as package manager', async () => {
    const config: Config<'evm'> = {
      projectFolder: projectDir,
      networkType: 'evm',
      network: 'ethereum-mainnet',
      templates: [evmTemplates['erc20Transfers']],
      contractAddresses: [],
      sink: 'clickhouse',
      packageManager: 'bun',
    }

    await new InitHandler(config).handle()

    await expect(isFile(path.join(projectDir, 'bun.lock'))).resolves.toBe(true)
  })
})
