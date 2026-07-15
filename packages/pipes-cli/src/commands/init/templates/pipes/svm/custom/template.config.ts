import { toSnakeCase } from 'drizzle-orm/casing'
import { z } from 'zod'

import { ContractSchema } from '../../../contract-params.js'
import { customContractsPrompt, customTypegenPostSetup } from '../../../custom-template-shared.js'
import { defineTemplate } from '../../../define-template.js'
import { renderClickhouse } from './templates/clickhouse-table.sql.js'
import { renderSchema } from './templates/pg-table.js'
import { buildDecoderGroups, renderTransformer } from './templates/transformer.js'

export const CustomTemplateParamsSchema = z.object({
  contracts: z.array(ContractSchema).describe('Programs to track: IDL-level identity plus its deployments'),
})

export type CustomTemplateParams = z.infer<typeof CustomTemplateParamsSchema>

export const customTemplate = defineTemplate({
  id: 'custom',
  name: 'Bring your own contracts',
  networkType: 'svm',
  paramsSchema: CustomTemplateParamsSchema,
  prompt: customContractsPrompt({
    networkType: 'svm',
    entity: 'program',
    members: 'instructions',
    interfaceNoun: 'IDL',
    verifiedSource: 'an on-chain Anchor program',
    rangeKnowsAddresses: false,
  }),
  postSetup: customTypegenPostSetup('svm'),
  render(params) {
    const groups = buildDecoderGroups(params)
    return {
      transformer: renderTransformer(params),
      postgresSchema: renderSchema(params),
      clickhouseTable: renderClickhouse(params),
      decoderIds: groups.map((g) => g.decoderId),
      tables: groups.flatMap((group) =>
        group.instructions.map((instruction) => ({
          decoderId: group.decoderId,
          table: toSnakeCase(`${instruction.contractName}_${instruction.name}`),
          event: instruction.uniqueKey,
        })),
      ),
    }
  },
})
