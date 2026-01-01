import path from 'node:path'
import { checkbox, input, select } from '@inquirer/prompts'
import chalk from 'chalk'
import { NetworkTemplate, templates } from '~/template/index.js'
import { networks } from '../../config/networks.js'
import { sinks } from '../../config/sinks.js'
import { templateOptions } from '../../config/templates.js'
import type { Config } from '../../types/config.js'
import { chainTypes, type NetworkType } from '../../types/network.js'
import { InitHandler } from './handler.js'

export class InitPrompt {
  async run() {
    try {
      const config = await this.promptConfig()
      const handler = new InitHandler(config)
      await handler.handle()
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error(`Failed to initialize project: ${String(error)}`)
    }
  }

  async promptConfig(): Promise<Config<NetworkType>> {
    const projectFolder = await input({
      message: `Where should we create your new project? ${chalk.dim('Enter a folder name or path:')}`,
      validate: (value: string) => {
        if (!value || value.trim().length === 0) {
          return 'Project folder cannot be empty'
        }

        const trimmed = value.trim()

        // Check for invalid characters in path
        const invalidChars = /[<>:"|?*\x00-\x1f]/
        if (invalidChars.test(trimmed)) {
          return 'Project folder contains invalid characters'
        }

        // Check for reserved names on Windows
        const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
        if (reservedNames.test(trimmed)) {
          return 'Project folder name is reserved'
        }

        try {
          path.resolve(trimmed)
        } catch {
          return 'Invalid path format'
        }

        return true
      },
    })

    const chainType = await select<NetworkType>({
      message: "Now, let's choose the type of blockchain you'd like to use:",
      choices: chainTypes.map((ct) => ({
        ...ct,
        disabled: ct.value === 'svm' ? '(Coming soon)' : false,
      })),
    })

    const network = await select({
      message: `Now, let's select the network you'd like to use. ${chalk.dim('(Tip: you can type to search)')}`,
      choices: networks[chainType].map((n) => ({
        name: n.name,
        value: n.slug,
      })),
    })

    const pipelineType = await select({
      message: `How would you like to build your pipeline? ${chalk.dim('Start from one of our templates or provide your own contract addresses')}`,
      choices: [
        { name: 'Use templates', value: 'templates' },
        { name: 'Custom contract', value: 'custom' },
      ],
    })

    let selectedTemplateMap: NetworkTemplate<NetworkType>
    let contractAddresses: string[] = []

    if (pipelineType === 'templates') {
      selectedTemplateMap = await this.promptTemplates(chainType)
    } else {
      if (chainType === 'evm') {
        selectedTemplateMap = { custom: templates.evm.custom }
      } else {
        selectedTemplateMap = { custom: templates.svm.custom }
      }

      const contractAddress = await input({
        message: 'Contract address:',
      })
      contractAddresses = contractAddress.trim() ? [contractAddress.trim()] : []
    }

    const sink = await select({
      message: 'Where would you like to store your data?',
      choices: sinks.map((s) => ({ name: s.name, value: s.id })),
    })

    return {
      projectFolder,
      chainType,
      network,
      templates: selectedTemplateMap,
      contractAddresses,
      sink,
    }
  }

  private promptTemplates(chainType: 'evm'): Promise<NetworkTemplate<'evm'>>
  private promptTemplates(chainType: 'svm'): Promise<NetworkTemplate<'svm'>>
  private promptTemplates(chainType: NetworkType): Promise<NetworkTemplate<'evm'> | NetworkTemplate<'svm'>>
  private async promptTemplates(chainType: NetworkType): Promise<NetworkTemplate<NetworkType>> {
    if (chainType === 'evm') {
      const disabledTemplates = ['morpho-blue', 'uniswap-v4', 'polymarket']
      const selected = await checkbox({
        message: 'Templates:',
        choices: templateOptions.evm.map((t) => ({
          name: t.name,
          value: t.id,
          disabled: disabledTemplates.includes(t.id) ? '(Coming soon)' : false,
        })),
      })
      return selected.reduce<NetworkTemplate<'evm'>>((acc, id) => {
        acc[id] = templates.evm[id]
        return acc
      }, {})
    }
    const selected = await checkbox({
      message: 'Templates:',
      choices: templateOptions.svm.map((t) => ({
        name: t.name,
        value: t.id,
      })),
    })
    return selected.reduce<NetworkTemplate<'svm'>>((acc, id) => {
      acc[id] = templates.svm[id]
      return acc
    }, {})
  }
}
