import { checkbox, input } from '@inquirer/prompts'
import chalk from 'chalk'
import { ContractMetadata, SqdAbiService } from '~/services/sqd-abi.js'
import { PipeTemplateMeta } from '~/types/init.js'
import { renderClickhouse } from './clickhouse-table.sql.js'
import { renderSchema } from './pg-table.js'
import { renderTransformer } from './transformer.js'

export const custom: PipeTemplateMeta<'evm', ContractMetadata[]> = {
  templateId: 'custom' as const,
  templateName: 'Bring your own contracts' as const,
  networkType: 'evm' as const,
  prompt: async (network) => {
    const addressesInput = await input({
      message: `Contract addresses. ${chalk.dim('Comma separated')}:\n`,
    })
    const addresses = addressesInput.split(',').map((address) => address.trim())
    const abiService = new SqdAbiService()
    const metadata = await abiService.getContractData('evm', network, addresses)

    const contracts: ContractMetadata[] = []
    for (const contract of metadata) {
      const events = await checkbox({
        message: `Pick the events to track for ${contract.contractName}:`,
        choices: contract.contractEvents.map((event) => ({
          name: event.name,
          value: event,
        })),
      })
      contracts.push({
        contractAddress: contract.contractAddress,
        contractName: contract.contractName,
        contractEvents: events,
      })
    }

    return contracts
  },
  templateFn(network, sink, params) {
    return {
      templateId: this.templateId,
      networkType: this.networkType,
      network,
      params,
      sink,
      renderFns: {
        transformers: () => renderTransformer({ params }),
        postgresSchemas: () => renderSchema({ params }),
        clickhouseTables: () => renderClickhouse({ params }),
      },
    }
  },
}

export type CustomTemplateParams = {
  params: ContractMetadata[]
}
