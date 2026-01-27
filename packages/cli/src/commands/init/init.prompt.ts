import path from 'node:path'
import { input, select } from '@inquirer/prompts'
import chalk from 'chalk'
import { z } from 'zod'
import type { Config, PackageManager, PipeTemplateMeta } from '~/types/init.js'
import { type NetworkType, networkTypes, packageManagerTypes } from '~/types/init.js'
import { networks } from './config/networks.js'
import { sinks } from './config/sinks.js'
import { getTemplatePrompts } from './config/templates.js'
import { InitHandler } from './init.handler.js'
import { getTemplate } from './builders/transformer-builder/index.js'

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

    const networksChoices = networks[networkType].map((n) => ({
      name: n.name,
      value: n.slug,
      priority: n.priority
    }))
    networksChoices.sort((a, b) => {
      if (a.priority && b.priority) return b.priority - a.priority
      if (a.priority) return -1
      if (b.priority) return 1
      return a.name.localeCompare(b.name)
    })

    const network = await select({
      message: `Now, let's select the network you'd like to use. ${chalk.dim('(Tip: you can type to search)')}`,
      choices: networksChoices,
      pageSize: 15,
    })

    const selectedTemplates = await this.templatePromptLoop(networkType, network)

    const sink = await select({
      message: 'Where would you like to store your data?',
      choices: sinks.map((s) => ({ name: s.name, value: s.id })),
    })

    return {
      projectFolder,
      networkType,
      network,
      templates: selectedTemplates,
      sink,
      packageManager,
    }
  }

  private async templatePromptLoop<N extends NetworkType>(
    networkType: N,
    network: string,
  ): Promise<PipeTemplateMeta<N, z.ZodObject>[]> {
    const choices = getTemplatePrompts(networkType)
    const selectedTemplates: PipeTemplateMeta<N, z.ZodObject>[] = []
    let addMore = true

    while (addMore) {
      const templateId = await select({
        message: 'Pick your starter template. You can select multiple:',
        choices,
        theme: {
          indexMode: 'number',
          style: {
            disabled: (text: string) => chalk.dim(`  ${text.replace('disabled', 'Coming soon')}`),
          },
        },
      })

      const template = getTemplate(networkType, templateId)
      await template.promptParams(network)
      selectedTemplates.push(template)

      addMore = await this.addMoreTemplates()
    }
    return selectedTemplates
  }


  private async addMoreTemplates() {
    const addMore = await select({
      message: 'Would you like to add more templates?',
      choices: [
        { name: 'Add more templates', value: 'yes' },
        { name: 'Continue to next step', value: 'no' },
      ],
    })

    return addMore === 'yes'
  }
}
