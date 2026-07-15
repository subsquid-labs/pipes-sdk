import z from 'zod'

import { tableName, uniqueEventKey } from '../../../../builders/target-builder/shared.js'
import { ContractSchema, flattenContracts } from '../../../contract-params.js'
import { customContractsPrompt, customTypegenPostSetup } from '../../../custom-template-shared.js'
import { defineTemplate } from '../../../define-template.js'
import { DecoderGrouping, groupContractsForDecoders } from './decoder-grouping.js'
import { renderClickhouse } from './templates/clickhouse-table.sql.js'
import { renderSchema } from './templates/pg-table.js'
import { renderTransformer } from './templates/transformer.js'

export const CustomTemplateParamsSchema = z.object({
  contracts: z.array(ContractSchema).describe('Contracts to track: ABI-level identity plus its deployments'),
})

export type CustomTemplateParams = z.infer<typeof CustomTemplateParamsSchema>

export function getGrouping(params: CustomTemplateParams): DecoderGrouping {
  return groupContractsForDecoders(flattenContracts(params.contracts))
}

export const customTemplate = defineTemplate({
  id: 'custom',
  name: 'Bring your own contracts',
  networkType: 'evm',
  paramsSchema: CustomTemplateParamsSchema,
  prompt: customContractsPrompt({
    networkType: 'evm',
    entity: 'contract',
    members: 'events',
    interfaceNoun: 'ABI',
    verifiedSource: 'an Etherscan-verified contract',
    rangeKnowsAddresses: true,
  }),
  postSetup: customTypegenPostSetup('evm'),
  render(params) {
    const grouping = getGrouping(params)
    return {
      transformer: renderTransformer(grouping),
      postgresSchema: renderSchema(grouping),
      clickhouseTable: renderClickhouse(grouping),
      decoderIds: grouping.groups.map((g) => g.decoderId),
      tables: grouping.groups.flatMap((group) =>
        group.events.map((event) => ({
          decoderId: group.decoderId,
          table: tableName(grouping, group.contracts[0]!.contractName, event, group.events),
          event: uniqueEventKey(event, group.events),
        })),
      ),
    }
  },
})
