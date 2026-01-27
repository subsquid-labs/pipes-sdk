import { checkbox, input } from '@inquirer/prompts'
import chalk from 'chalk'
import { ContractMetadata, SqdAbiService } from '~/services/sqd-abi.js'
import { PipeTemplateMeta } from '~/types/init.js'
import { renderClickhouse } from './templates/clickhouse-table.sql.js'
import { renderSchema } from './templates/pg-table.js'
import { renderTransformer } from './templates/transformer.js'
import z from 'zod'

const RawInputSchema = z.object({ name: z.string(), type: z.string() })

const RawAbiEventSchema = z.object({ name: z.string(), type: z.string(), inputs: z.array(RawInputSchema) })

export const CustomTemplateParamsSchema = z.object({
  contracts: z
    .array(z.object({
      contractAddress: z.string(),
      contractName: z.string(),
      contractEvents: z.array(RawAbiEventSchema),
    }))
})

export type CustomTemplateParams = z.infer<typeof CustomTemplateParamsSchema>

class CustomTemplate extends PipeTemplateMeta<'evm', typeof CustomTemplateParamsSchema> {
  templateId = 'custom'
  templateName = 'Bring your own contracts'
  networkType = 'evm' as const
  override paramsSchema = CustomTemplateParamsSchema

  override async collectParamsCustom(network: string) {
    const addressesInput = await input({
      message: `Contract addresses. ${chalk.dim('Comma separated')}:`,
    })
    const addresses = addressesInput.split(',').map((address) => address.trim())
    const abiService = new SqdAbiService()
    const metadata = await abiService.getContractData('evm', network, addresses)

    const contracts: ContractMetadata[] = []
    for (const contract of metadata) {
      const choices = contract.contractEvents.map((event) => ({
        name: event.name,
        value: event,
      }))
      choices.sort((a, b) => a.name.localeCompare(b.name))
      const events = await checkbox({
        message: `Pick the events to track for ${contract.contractName}:`,
        choices,
      })
      contracts.push({
        contractAddress: contract.contractAddress,
        contractName: contract.contractName,
        contractEvents: events,
      })
    }

    this.setParams({ contracts })
  }

  override async postSetup(network: string, projectPath: string): Promise<void> {
    const abiService = new SqdAbiService()
    await abiService.generateTypes(
      this.networkType,
      network,
      projectPath,
      this.getParams().contracts.map((c) => c.contractAddress),
    )
  }

  override renderTransformers() {
    return renderTransformer(this.getParams())
  }

  override renderPostgresSchemas() {
    return renderSchema(this.getParams())
  }

  override renderClickhouseTables() {
    return renderClickhouse(this.getParams())
  }
}

export const custom = new CustomTemplate()
