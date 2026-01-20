import path from 'node:path'
import { checkbox, input, select } from '@inquirer/prompts'
import chalk from 'chalk'
import type { Config, PackageManager } from '~/types/init.js'
import { type NetworkType, networkTypes, packageManagerTypes, TransformerTemplate } from "~/types/init.js"
import { networks } from './config/networks.js'
import { sinks } from './config/sinks.js'
import { templateOptions } from './config/templates.js'
import { InitHandler } from './init.handler.js'
import { templates } from './templates/pipe-components/template-builder.js'
import { evmTemplates } from './templates/pipe-templates/evm/index.js'
import { svmTemplates } from './templates/pipe-templates/svm/index.js'

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

        /*
         * Check for invalid characters in path.
         * This pattern matches any of: angle brackets < >, colon :, double quote ", pipe |, question mark ?, asterisk *,
         * as well as ASCII control characters (hex 00-1F, inclusive).
         */
        const invalidChars = /[<>:"|?*\x00-\x1f]/
        if (invalidChars.test(trimmed)) {
          return 'Project folder contains invalid characters (forbidden: <, >, :, ", |, ?, *, ASCII 0-31)'
        }

        /*
         * Check for reserved names on Windows
         * This pattern matches any of: CON, PRN, AUX, NUL, COM[1-9], LPT[1-9],
         * as well as any name ending with a period.
         */
        const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i
        if (reservedNames.test(trimmed)) {
          return 'Project folder name is reserved (forbidden: CON, PRN, AUX, NUL, COM[1-9], LPT[1-9])'
        }

        try {
          path.resolve(trimmed)
        } catch {
          return 'Invalid path format'
        }

        return true
      },
    })

    const packageManager = await select<PackageManager>({
      message: 'Which package manager would you like to use?',
      choices: packageManagerTypes,
    })

    const networkType = await select<NetworkType>({
      message: "Now, let's choose the type of blockchain you'd like to use:",
      choices: networkTypes,
    })

    const network = await select({
      message: `Now, let's select the network you'd like to use. ${chalk.dim('(Tip: you can type to search)')}`,
      choices: networks[networkType].map((n) => ({
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

    let selectedTemplates: TransformerTemplate<NetworkType>[] = []
    let contractAddresses: string[] = []

    if (pipelineType === 'templates') {
      selectedTemplates = await this.promptTemplates(networkType)
    } else {
      selectedTemplates = [templates[networkType]['custom']]

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
      networkType: networkType,
      network,
      templates: selectedTemplates,
      contractAddresses,
      sink,
      packageManager,
    }
  }

  private promptTemplates(chainType: 'evm'): Promise<TransformerTemplate<NetworkType>[]>
  private promptTemplates(chainType: 'svm'): Promise<TransformerTemplate<NetworkType>[]>
  private promptTemplates(chainType: NetworkType): Promise<TransformerTemplate<NetworkType>[]>
  private async promptTemplates(chainType: NetworkType): Promise<TransformerTemplate<NetworkType>[]> {
    if (chainType === 'evm') {
      const selected = await checkbox({
        message: 'Templates:',
        choices: templateOptions.evm.map((t) => ({
          name: t.name,
          value: t.id,
          disabled: t.disabled ? '(Coming soon)' : false,
        })),
      })
      return selected.reduce<TransformerTemplate<'evm'>[]>((acc, id) => {
        acc.push(evmTemplates[id])
        return acc
      }, [])
    }
    const selected = await checkbox({
      message: 'Templates:',
      choices: templateOptions.svm.map((t) => ({
        name: t.name,
        value: t.id,
      })),
    })
    return selected.reduce<TransformerTemplate<'svm'>[]>((acc, id) => {
      acc.push(svmTemplates[id])
      return acc
    }, [])
  }
}
