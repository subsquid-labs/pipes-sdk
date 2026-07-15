import { input, select } from '@inquirer/prompts'
import chalk from 'chalk'

import { SqdAbiService } from '~/services/sqd-abi.js'
import type { NetworkType } from '~/types/init.js'

import { createPromptContext } from '../templates/prompt-context.js'
import { TemplatePromptCancelled } from '../templates/prompt-resilience.js'
import { getTemplate } from '../templates/registry.js'
import type { ConfiguredTemplate } from '../templates/template.js'
import { getTemplatePrompts } from './templates.js'

export const SKIP_TEMPLATE_VALUE = '__skip__' as const

export async function templatePromptLoop<N extends NetworkType>(
  networkType: N,
  network: string,
): Promise<ConfiguredTemplate<N, unknown>[]> {
  const templateChoices = getTemplatePrompts(networkType)
  const selectedTemplates: ConfiguredTemplate<N, unknown>[] = []
  // One ABI service for the whole loop: its cache spans templates, so a contract
  // referenced twice is fetched once.
  const abiService = new SqdAbiService()
  let addMore = true

  while (addMore) {
    const choices =
      selectedTemplates.length > 0
        ? [...templateChoices, { name: 'Skip - continue to next step', value: SKIP_TEMPLATE_VALUE }]
        : templateChoices

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

    if (templateId === SKIP_TEMPLATE_VALUE) {
      addMore = false
      continue
    }

    const template = getTemplate(networkType, templateId)
    if (!template) continue

    const promptCtx = createPromptContext(networkType, network, abiService)
    let params: unknown
    try {
      params = template.prompt ? await template.prompt(promptCtx) : undefined
    } catch (error) {
      // The user backed out of this template's prompt: drop back to template
      // selection with everything assembled so far intact.
      if (error instanceof TemplatePromptCancelled) continue
      throw error
    }
    selectedTemplates.push({ template, params })

    addMore = await askAddMoreTemplates()
  }

  return selectedTemplates
}

async function askAddMoreTemplates(): Promise<boolean> {
  const addMore = await select({
    message: 'Would you like to add more templates?',
    choices: [
      { name: 'Add more templates', value: 'yes' },
      { name: 'Continue to next step', value: 'no' },
    ],
  })
  return addMore === 'yes'
}

// Re-export to keep stable deps for the test file
export { input }
