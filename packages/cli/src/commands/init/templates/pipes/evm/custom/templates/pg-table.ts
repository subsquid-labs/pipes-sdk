import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { evmToPostgresType } from '~/utils/db-type-map.js'

import { tableToSchemaName } from '../../../../../builders/schema-builder/index.js'
import { type DecoderGrouping } from '../decoder-grouping.js'
import { CustomTemplateParams } from '../template.config.js'
import { groupContractsForDecoders } from '../decoder-grouping.js'

export const customContractPgTemplate = `
import {
  bigint,
  char,
  integer,
  pgTable,
  primaryKey,
  {{#typeImports}}
  {{.}},
  {{/typeImports}}
} from 'drizzle-orm/pg-core'

{{#contracts}}
export const {{schemaName}} = pgTable(
  '{{tableName}}',
  {
    blockNumber: integer().notNull(),
    txHash: char({ length: 66 }).notNull(),
    logIndex: integer().notNull(),
    timestamp: bigint({ mode: 'number' }).notNull(),

    {{#inputs}}
    {{name}}: {{{dbType}}},
    {{/inputs}}
  },
  (table) => [
    primaryKey({
      columns: [table.blockNumber, table.txHash, table.logIndex],
    }),
  ],
)

{{/contracts}}
`

export function tableName(grouping: DecoderGrouping, contractName: string, eventName: string) {
  return grouping.shared ? toSnakeCase(eventName) : toSnakeCase(`${contractName}_${eventName}`)
}

export function renderSchema({ contracts }: CustomTemplateParams) {
  const grouping = groupContractsForDecoders(contracts)
  const contracsWithDbTypes = getContractWithDbTypes(grouping)

  return Mustache.render(customContractPgTemplate, {
    typeImports: generateDrizzleImports(contracsWithDbTypes),
    contracts: contracsWithDbTypes,
  })
}

export function getContractWithDbTypes(grouping: DecoderGrouping) {
  return grouping.groups.flatMap((group) =>
    group.events.map((e) => {
      const tbl = tableName(grouping, group.contracts[0].contractName, e.name)
      return {
        event: e.name,
        decoderId: group.decoderId,
        schemaName: tableToSchemaName(tbl),
        tableName: tbl,
        inputs: e.inputs.map((i) => ({
          ...i,
          dbType: evmToPostgresType(i.type),
        })),
      }
    }),
  )
}

function generateDrizzleImports(contracts: ReturnType<typeof getContractWithDbTypes>) {
  return contracts.flatMap((c) => c.inputs.map((i) => extractDrizzleType(i.dbType)))
}

const TYPE_REGEX = /^\s*([A-Za-z_$][\w$]*)\s*(?=\()/
function extractDrizzleType(input: string) {
  const m = input.match(TYPE_REGEX)
  if (!m) throw new Error(`Invalid type string: "${input}"`)
  return m[1]
}
