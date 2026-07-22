import { z } from 'zod'

import { ContractSchema } from '../../../contract-params.js'
import { customContractsPrompt, customTypegenPostSetup } from '../../../custom-template-shared.js'
import { defineTemplate } from '../../../define-template.js'
import { renderClickhouse } from './templates/clickhouse-table.sql.js'
import { programTables } from './templates/naming.js'
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

    // Same derivation the schema and DDL use, keyed by program identity — a decoder's
    // insert target must be a table the generated schema actually declares.
    const tableByInstruction = new Map(
      programTables(params.contracts).map((t) => [`${t.typegenAddress}|${t.instruction.name}`, t.table]),
    )

    return {
      transformer: renderTransformer(params),
      postgresSchema: renderSchema(params),
      clickhouseTable: renderClickhouse(params),
      decoderIds: groups.map((g) => g.decoderId),
      tables: groups.flatMap((group) =>
        group.instructions.map((instruction) => ({
          decoderId: group.decoderId,
          table: tableByInstruction.get(`${group.programs[0]!.typegenAddress}|${instruction.name}`)!,
          event: instruction.uniqueKey,
        })),
      ),
    }
  },
})
