import path from 'node:path'
import { input, select } from '@inquirer/prompts'
import chalk from 'chalk'
import { z } from 'zod'
import type { Config, PackageManager, PipeTemplate, PipeTemplateMeta } from '~/types/init.js'
import { type NetworkType, networkTypes, packageManagerTypes } from '~/types/init.js'
import { getDefaults } from '~/utils/zod.js'
import { networks } from './config/networks.js'
import { sinks } from './config/sinks.js'
import { getTemplatePrompts } from './config/templates.js'
import { InitHandler } from './init.handler.js'
import { getTemplate } from './templates/pipe-components/transformer-builder/index.js'

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

    const selectedTemplates = await this.templatePromptLoop(networkType, network)

    const sink = await select({
      message: 'Where would you like to store your data?',
      choices: sinks.map((s) => ({ name: s.name, value: s.id })),
    })

    return {
      projectFolder,
      networkType,
      templates: selectedTemplates,
      sink,
      packageManager,
    }
  }

  private async templatePromptLoop<N extends NetworkType>(
    networkType: N,
    network: string,
  ): Promise<PipeTemplate<N, z.ZodObject>[]> {
    const choices = getTemplatePrompts(networkType)
    const selectedTemplates: PipeTemplate<N, z.ZodObject>[] = []
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
      const params = template.prompt ? await template.prompt(network) : await this.promptTemplateParams(template)
      const pipeTemplate = template.templateFn(network, 'postgresql', params)
      selectedTemplates.push(pipeTemplate)

      addMore = await this.addMoreTemplates()
    }
    return selectedTemplates
  }


  private async addMoreTemplates() {
    const addMore = await select({
      message: 'Would you like to add more templates?',
      choices: [
        { name: 'Yes. Add more templates', value: 'yes' },
        { name: 'No. Continue to next step', value: 'no' },
      ],
    })

    return addMore === 'yes'
  }


  private async promptTemplateParams<N extends NetworkType>(
    template: PipeTemplateMeta<N, z.ZodObject>,
  ): Promise<z.infer<typeof template.paramsSchema>> {
    const params = template.paramsSchema

    if (!params) {
      throw new Error('A template has to either define a params schema or a prompt function. Please check the template configuration.')
    }

    const entries = Object.keys(params.shape)
    const values: Record<string, string | string[]> = {}
    const defaultValues = getDefaults(params)

    for (const key of entries) {
      const description = params.shape[key].meta()?.description
      const type = params.shape[key].type === 'default' ? params.shape[key].unwrap().type : params.shape[key].type
      const defaultValue = defaultValues[key]

      let formattedDefault: string | undefined
      if (defaultValue) {
        if (typeof defaultValue === 'string') {
          formattedDefault = defaultValue
        } else if (Array.isArray(defaultValue)) {
          formattedDefault = defaultValue.join(',')
        }
      }

      const value = await input({
        default: formattedDefault,
        message: `${description} ${type === 'array' ? chalk.dim(`. Comma separated`) : ''}`,
        validate: (value: string) => {
          return value.trim().length > 0 ? true : 'Value cannot be empty'
        },
      })

      values[key] = type === 'array' ? [...value.trim().split(',')].flat() : value
    }

    return params.parse(values)
  }
}
