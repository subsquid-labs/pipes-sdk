import { input, select } from '@inquirer/prompts'
import chalk from 'chalk'

import { SqdAbiService } from '~/services/sqd-abi.js'
import { NetworkType } from '~/types/init.js'

export interface BlockRange {
  from: string
  to?: string
}

interface PromptBlockRangeOpts {
  networkType: NetworkType
  network: string
  contractAddresses?: string[]
}

function formatBlock(block: string): string {
  return Number(block).toLocaleString('en-US')
}

async function fetchOldestDeploymentBlock(network: string, addresses: string[]): Promise<string | null> {
  try {
    const abiService = new SqdAbiService()
    const blocks = await Promise.all(addresses.map((a) => abiService.getContractCreationBlock(network, a)))
    const oldest = blocks.reduce((min, b) => (Number(b) < Number(min) ? b : min))
    return oldest
  } catch {
    return null
  }
}

async function promptFromBlock(opts: PromptBlockRangeOpts): Promise<string> {
  const canFetchDeployment = opts.networkType === 'evm' && opts.contractAddresses?.length

  let deploymentBlock: string | null = null
  if (canFetchDeployment) {
    deploymentBlock = await fetchOldestDeploymentBlock(opts.network, opts.contractAddresses!)
  }

  type FromChoice = 'latest' | 'deployment' | 'custom'
  const choices: { name: string; value: FromChoice }[] = [
    { name: 'Start from the latest block', value: 'latest' },
  ]

  if (deploymentBlock) {
    const suffix = opts.contractAddresses!.length > 1 ? ' - oldest contract' : ''
    choices.push({
      name: `Start from deployment block ${chalk.dim(`(block ${formatBlock(deploymentBlock)}${suffix})`)}`,
      value: 'deployment',
    })
  }

  choices.push({ name: 'Start from a specific block', value: 'custom' })

  const choice = await select<FromChoice>({ message: 'Where should indexing start?', choices })

  if (choice === 'latest') return 'latest'
  if (choice === 'deployment') return formatBlock(deploymentBlock!)

  return input({
    message: 'Enter the starting block number:',
    validate: (v) => (/^\d+$/.test(v.trim()) ? true : 'Must be a valid block number'),
  })
}

async function promptToBlock(): Promise<string | undefined> {
  type ToChoice = 'indefinite' | 'custom'
  const choice = await select<ToChoice>({
    message: 'Where should indexing stop?',
    choices: [
      { name: 'Run indefinitely (recommended)', value: 'indefinite' },
      { name: 'Stop at a specific block', value: 'custom' },
    ],
  })

  if (choice === 'indefinite') return undefined

  return input({
    message: 'Enter the ending block number:',
    validate: (v) => (/^\d+$/.test(v.trim()) ? true : 'Must be a valid block number'),
  })
}

export async function promptBlockRange(opts: PromptBlockRangeOpts): Promise<BlockRange> {
  const from = await promptFromBlock(opts)
  const to = await promptToBlock()
  return { from, to }
}
