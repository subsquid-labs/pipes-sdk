import { z } from 'zod'

import { ContractMetadata, SqdAbiService } from '~/services/sqd-abi.js'
import { resolveDuplicateContractNames } from '~/utils/resolve-duplicate-contracts.js'

import { defineTemplate } from '../../../define-template.js'
import { renderClickhouse } from './templates/clickhouse-table.sql.js'
import { renderSchema } from './templates/pg-table.js'
import { buildDecoderGroups, renderTransformer } from './templates/transformer.js'

const RawInputSchema: z.ZodType<{ name: string; type: string; components?: unknown }> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    components: z.array(RawInputSchema).optional(),
  }),
)

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

export const customTemplate = defineTemplate({
  id: 'custom',
  name: 'Bring your own contracts',
  networkType: 'svm',
  paramsSchema: CustomTemplateParamsSchema,
  async prompt(ctx) {
    const addressesInput = await ctx.text('Contract addresses (comma separated)')
    const addresses = addressesInput
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean)

    const metadata = await ctx.abiService.getContractData('svm', ctx.network, addresses)
    await resolveDuplicateContractNames(metadata)

    const contracts: (ContractMetadata & { range: { from: string; to?: string } })[] = []
    for (const contract of metadata) {
      const choices = contract.contractEvents
        .map((event) => ({ name: event.name, value: event }))
        .sort((a, b) => a.name.localeCompare(b.name))

      const events = await ctx.checkbox(`Pick the events to track for ${contract.contractName}`, choices)
      const range = await ctx.blockRange(`Block range for ${contract.contractName}`)

      contracts.push({
        contractAddress: contract.contractAddress,
        contractName: contract.contractName,
        contractEvents: events as any,
        range,
      })
    }

    return { contracts }
  },
  async postSetup(params, ctx) {
    const abiService = new SqdAbiService()
    await abiService.generateTypes(
      'svm',
      ctx.network,
      ctx.projectPath,
      params.contracts.map((c) => c.contractAddress),
    )
  },
  render(params) {
    return {
      transformer: renderTransformer(params),
      postgresSchema: renderSchema(params),
      clickhouseTable: renderClickhouse(params),
      decoderIds: buildDecoderGroups(params).map((g) => g.decoderId),
    }
  },
})
