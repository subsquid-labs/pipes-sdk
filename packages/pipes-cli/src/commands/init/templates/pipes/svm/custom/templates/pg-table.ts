import Mustache from 'mustache'

import { svmToPostgresType } from '~/utils/db-type-map.js'

import { tableToSchemaName } from '../../../../../builders/schema-builder/index.js'
import { CustomTemplateParams } from '../template.config.js'
import { ProgramTable, programTables } from './naming.js'

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

export function renderSchema({ contracts }: CustomTemplateParams) {
  const contractsWithDbTypes = getContractWithDbTypes(programTables(contracts))

  return Mustache.render(customContractPgTemplate, {
    typeImports: generateDrizzleImports(contractsWithDbTypes),
    contracts: contractsWithDbTypes,
  })
}

export function getContractWithDbTypes(tables: ProgramTable[]) {
  return tables.map(({ instruction, table }) => ({
    event: instruction.name,
    schemaName: tableToSchemaName(table),
    tableName: table,
    inputs: instruction.inputs.map((i) => ({
      ...i,
      dbType: svmToPostgresType(i.type),
    })),
  }))
}

function generateDrizzleImports(contracts: ReturnType<typeof getContractWithDbTypes>) {
  return [...new Set(contracts.flatMap((c) => c.inputs.map((i) => extractDrizzleType(i.dbType))))]
}

const TYPE_REGEX = /^\s*([A-Za-z_$][\w$]*)\s*(?=\()/
function extractDrizzleType(input: string) {
  const m = input.match(TYPE_REGEX)
  if (!m) throw new Error(`Invalid type string: "${input}"`)
  return m[1]
}
