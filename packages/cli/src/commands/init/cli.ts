import { checkbox, input, select } from '@inquirer/prompts'
import { NetworkTemplate, templates } from '~/template/index.js'
import { networks } from '../../config/networks.js'
import { sinks } from '../../config/sinks.js'
import { templateOptions } from '../../config/templates.js'
import type { Config } from '../../types/config.js'
import { chainTypes, type NetworkType } from '../../types/network.js'
import { InitHandler } from './handler.js'

export class InitConfig {
  async run() {
    const config = await this.promptConfig()
    this.displaySummary(config)
    const handler = new InitHandler(config)
    await handler.handle()
  }

  async promptConfig(): Promise<Config<NetworkType>> {
    const projectFolder = await input({
      message: 'Project folder:',
    })

    const chainType = await select<NetworkType>({
      message: 'Chain type:',
      choices: chainTypes,
    })

    const network = await select({
      message: 'Chain:',
      choices: networks[chainType].map((n) => ({
        name: n.name,
        value: n.slug,
      })),
    })

    const pipelineType = await select({
      message: 'Pipeline type:',
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
      message: 'Sink:',
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
      const selected = await checkbox({
        message: 'Templates:',
        choices: templateOptions.evm.map((t) => ({
          name: t.name,
          value: t.id,
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

  private displaySummary(config: Config<NetworkType>): void {
    const isCustomContract = config.contractAddresses.length > 0

    console.log('')
    console.log(`√ Project folder: ${config.projectFolder}`)
    console.log(`√ Chain type: ${config.chainType.toUpperCase()}`)
    console.log(`√ Chain: ${config.network}`)
    console.log(`√ Pipeline type: ${isCustomContract ? 'Custom contract' : 'Templates'}`)
    if (isCustomContract) {
      console.log(`√ Contract address: ${config.contractAddresses[0]}`)
    } else {
      console.log(`√ Templates: ${Object.keys(config.templates).join(', ')}`)
    }
    console.log(`√ Sink: ${config.sink}`)
    console.log('')
    console.log(`✅ Project created at ./${config.projectFolder}`)
  }
}
