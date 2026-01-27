import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { ContractMetadata, RawAbiItem } from '~/services/sqd-abi.js'
import { evmToPostgresType } from '~/utils/db-type-map.js'
import { tableToSchemaName } from '../../../pipe-components/schemas-template.js'
import { CustomTemplateParams } from './template.config.js'

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

export const eventTableName = (contract: ContractMetadata, event: RawAbiItem) =>
  toSnakeCase(`${contract.contractName}_${event.name}`)

export function renderSchema({ params }: CustomTemplateParams) {
  const contracsWithDbTypes = getContractWithDbTypes(params)

  return Mustache.render(customContractPgTemplate, {
    typeImports: generateDrizzleImports(contracsWithDbTypes),
    contracts: contracsWithDbTypes,
  })
}

export function getContractWithDbTypes(contracts: ContractMetadata[]) {
  return contracts.flatMap((c) =>
    c.contractEvents.map((e) => {
      const tableName = eventTableName(c, e)
      return {
        event: e.name,
        schemaName: tableToSchemaName(tableName),
        tableName,
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
