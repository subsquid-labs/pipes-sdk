import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { ContractMetadata, RawAbiItem } from '~/services/sqd-abi.js'
import { svmToPostgresType } from '~/utils/db-type-map.js'

import { tableToSchemaName } from '../../../../../builders/schema-builder/index.js'
import { referenceAddress } from '../../../../contract-params.js'
import { CustomTemplateParams } from '../template.config.js'

export const customContractPgTemplate = `
import {
  bigint,
  integer,
  pgTable,
  primaryKey,
  varchar,
  {{#typeImports}}
  {{.}},
  {{/typeImports}}
} from 'drizzle-orm/pg-core'

{{#contracts}}
export const {{schemaName}} = pgTable(
  '{{tableName}}',
  {
    blockNumber: integer().notNull(),
    transactionIndex: integer().notNull(),
    instructionAddress: varchar().notNull(),
    programId: varchar({ length: 44 }).notNull(),
    timestamp: bigint({ mode: 'number' }).notNull(),
    // Add here the columns for the custom contract events

    {{#inputs}}
    {{name}}: {{{dbType}}},
    {{/inputs}}
  },
  (table) => [
    primaryKey({
      columns: [table.blockNumber, table.transactionIndex, table.instructionAddress],
    }),
  ],
)

{{/contracts}}
`

export const eventTableName = (contract: ContractMetadata, event: RawAbiItem) =>
  toSnakeCase(`${contract.contractName}_${event.name}`)

export function renderSchema({ contracts: contractEntries }: CustomTemplateParams) {
  // Tables are contract-level (shaped by the event set); deployments share them.
  const contracts = contractEntries.map((c) => ({
    contractName: c.contractName,
    contractEvents: c.contractEvents,
    contractAddress: referenceAddress(c),
  }))
  const contractsWithDbTypes = getContractWithDbTypes(contracts)

  return Mustache.render(customContractPgTemplate, {
    typeImports: generateDrizzleImports(contractsWithDbTypes),
    contracts: contractsWithDbTypes,
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
          dbType: svmToPostgresType(i.type),
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
