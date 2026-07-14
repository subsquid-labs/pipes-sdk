import z from 'zod'

import { RawAbiEvent, SqdAbiService } from '~/services/sqd-abi.js'

import {
  type ContractParams,
  ContractSchema,
  type Deployment,
  flattenContracts,
  referenceAddress,
} from '../../../contract-params.js'
import type { PromptContext } from '../../../define-template.js'
import { defineTemplate } from '../../../define-template.js'
import { DecoderGrouping, groupContractsForDecoders } from './decoder-grouping.js'
import { renderClickhouse } from './templates/clickhouse-table.sql.js'
import { renderSchema } from './templates/pg-table.js'
import { renderTransformer } from './templates/transformer.js'

export const CustomTemplateParamsSchema = z.object({
  contracts: z.array(ContractSchema).describe('Contracts to track: ABI-level identity plus its deployments'),
})

export type CustomTemplateParams = z.infer<typeof CustomTemplateParamsSchema>

const groupingCache = new WeakMap<CustomTemplateParams['contracts'], DecoderGrouping>()

export function getGrouping(params: CustomTemplateParams): DecoderGrouping {
  const cached = groupingCache.get(params.contracts)
  if (cached) return cached
  const grouping = groupContractsForDecoders(flattenContracts(params.contracts))
  groupingCache.set(params.contracts, grouping)
  return grouping
}

async function promptContract(ctx: PromptContext): Promise<ContractParams> {
  // Contract level: the reference deployment's address is how we obtain the ABI.
  const address = (await ctx.text('Contract address')).trim()
  const [metadata] = await ctx.abiService.getContractData('evm', ctx.network, [address])

  const choices = metadata!.contractEvents
    .map((event) => ({ name: event.name, value: event }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const events = (await ctx.checkbox(
    `Pick the events to track for ${metadata!.contractName}`,
    choices,
  )) as RawAbiEvent[]

  // Deployment level: the reference deployment first, then any further ones.
  const deployments: Deployment[] = [
    {
      address,
      range: await ctx.blockRange(`Block range for ${metadata!.contractName}`, { contractAddresses: [address] }),
    },
  ]

  while (await ctx.confirm(`Add another deployment of ${metadata!.contractName}?`, false)) {
    const extraAddress = (await ctx.text(`Deployment address of ${metadata!.contractName}`)).trim()
    deployments.push({
      address: extraAddress,
      range: await ctx.blockRange(`Block range for ${extraAddress}`, { contractAddresses: [extraAddress] }),
    })
  }

  return {
    contractName: metadata!.contractName,
    contractEvents: events,
    deployments,
  }
}

export const customTemplate = defineTemplate({
  id: 'custom',
  name: 'Bring your own contracts',
  networkType: 'evm',
  paramsSchema: CustomTemplateParamsSchema,
  async prompt(ctx) {
    const contracts: ContractParams[] = [await promptContract(ctx)]

    while (await ctx.confirm('Add another contract?', false)) {
      contracts.push(await promptContract(ctx))
    }

    // Duplicate-name resolution is centralized in prepareConfig, which runs for
    // both the interactive and --config paths.
    return { contracts }
  },
  async postSetup(params, ctx) {
    // Typegen needs one deployment per contract — every deployment shares the ABI.
    const abiService = ctx.abiService ?? new SqdAbiService()
    await abiService.generateTypes('evm', ctx.network, ctx.projectPath, params.contracts.map(referenceAddress))
  },
  render(params) {
    const grouping = getGrouping(params)
    return {
      transformer: renderTransformer(grouping),
      postgresSchema: renderSchema(grouping),
      clickhouseTable: renderClickhouse(grouping),
      decoderIds: grouping.groups.map((g) => g.decoderId),
    }
  },
})
