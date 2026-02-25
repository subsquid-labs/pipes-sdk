import { PipeTemplateMeta } from '~/types/init.js'
import { renderTransformer } from './templates/transformer.js'
import { ContractMetadata, SqdAbiService } from '~/services/sqd-abi.js'
import { renderSchema } from './templates/pg-table.js'
import { renderClickhouse } from './templates/clickhouse-table.sql.js'
import { z } from 'zod'
import { input, checkbox } from '@inquirer/prompts'
import chalk from 'chalk'
import { promptBlockRange } from '~/utils/block-range-prompt.js'
import { resolveDuplicateContractNames } from '~/utils/resolve-duplicate-contracts.js'

const RawInputSchema = z.object({ name: z.string(), type: z.string() })

const RawAbiEventSchema = z.object({ name: z.string(), type: z.string(), inputs: z.array(RawInputSchema) })

const BlockRangeSchema = z.object({
  from: z.string(),
  to: z.string().optional(),
})

export const CustomTemplateParamsSchema = z.object({
  contracts: z.array(
    z.object({
      contractAddress: z.string(),
      contractName: z.string(),
      contractEvents: z.array(RawAbiEventSchema),
      range: BlockRangeSchema.default({ from: 'latest' }),
    }),
  ),
})

export type CustomTemplateParams = z.infer<typeof CustomTemplateParamsSchema>

class CustomTemplate extends PipeTemplateMeta<'svm', typeof CustomTemplateParamsSchema> {
  templateId = 'custom'
  templateName = 'Bring your own contracts'
  networkType = 'svm' as const
  override paramsSchema = CustomTemplateParamsSchema

  override async collectParamsCustom(network: string) {
    const addressesInput = await input({
      message: `Contract addresses. ${chalk.dim('Comma separated')}:`,
    })
    const addresses = addressesInput.split(',').map((address) => address.trim())
    const abiService = new SqdAbiService()
    const metadata = await abiService.getContractData('svm', network, addresses)

    await resolveDuplicateContractNames(metadata)

    const contracts: (ContractMetadata & { range: { from: string; to?: string } })[] = []
    for (const contract of metadata) {
      const choices = contract.contractEvents.map((event) => ({
        name: event.name,
        value: event,
      }))
      choices.sort((a, b) => a.name.localeCompare(b.name))

      const events = await checkbox({
        message: `Pick the events to track for ${contract.contractName}:`,
        choices,
        pageSize: 15,
      })

      const range = await promptBlockRange({
        networkType: 'svm',
        network,
      })

      contracts.push({
        contractAddress: contract.contractAddress,
        contractName: contract.contractName,
        contractEvents: events,
        range,
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
