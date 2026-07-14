import { z } from 'zod'

import { RawAbiEvent, SqdAbiService } from '~/services/sqd-abi.js'

import { type ContractParams, ContractSchema, type Deployment, referenceAddress } from '../../../contract-params.js'
import type { PromptContext } from '../../../define-template.js'
import { defineTemplate } from '../../../define-template.js'
import { renderClickhouse } from './templates/clickhouse-table.sql.js'
import { renderSchema } from './templates/pg-table.js'
import { buildDecoderGroups, renderTransformer } from './templates/transformer.js'

export const CustomTemplateParamsSchema = z.object({
  contracts: z.array(ContractSchema).describe('Programs to track: IDL-level identity plus its deployments'),
})

export type CustomTemplateParams = z.infer<typeof CustomTemplateParamsSchema>

async function promptProgram(ctx: PromptContext): Promise<ContractParams> {
  // Program level: the reference deployment's address is how we obtain the IDL.
  const address = (await ctx.text('Program address')).trim()
  const [metadata] = await ctx.abiService.getContractData('svm', ctx.network, [address])

  const choices = metadata!.contractEvents
    .map((event) => ({ name: event.name, value: event }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const events = (await ctx.checkbox(
    `Pick the instructions to track for ${metadata!.contractName}`,
    choices,
  )) as RawAbiEvent[]

  const deployments: Deployment[] = [
    { address, range: await ctx.blockRange(`Block range for ${metadata!.contractName}`) },
  ]

  while (await ctx.confirm(`Add another deployment of ${metadata!.contractName}?`, false)) {
    const extraAddress = (await ctx.text(`Deployment address of ${metadata!.contractName}`)).trim()
    deployments.push({ address: extraAddress, range: await ctx.blockRange(`Block range for ${extraAddress}`) })
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
  networkType: 'svm',
  paramsSchema: CustomTemplateParamsSchema,
  async prompt(ctx) {
    const contracts: ContractParams[] = [await promptProgram(ctx)]

    while (await ctx.confirm('Add another program?', false)) {
      contracts.push(await promptProgram(ctx))
    }

    // Duplicate-name resolution is centralized in prepareConfig, which runs for
    // both the interactive and --config paths.
    return { contracts }
  },
  async postSetup(params, ctx) {
    // Typegen needs one deployment per program — every deployment shares the IDL.
    const abiService = ctx.abiService ?? new SqdAbiService()
    await abiService.generateTypes('svm', ctx.network, ctx.projectPath, params.contracts.map(referenceAddress))
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
