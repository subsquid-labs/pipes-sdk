import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { svmToClickhouseType } from '~/utils/db-type-map.js'

import { CustomTemplateParams } from '../template.config.js'
import { ProgramTable, programTables } from './naming.js'

export const customContractChTemplate = `
{{#contracts}}
CREATE TABLE IF NOT EXISTS {{tableName}} (
  -- Event params
  {{#inputs}}
  {{name}} {{dbType}},
  {{/inputs}}
  -- Event metadata
  block_number UInt64,
  transaction_index UInt32,
  instruction_address String,
  program_id String,
  timestamp DateTime CODEC (DoubleDelta, ZSTD),
  sign Int8  DEFAULT toInt8(1),
  INDEX _sqd_rollback_idx block_number TYPE minmax GRANULARITY 1
)
ENGINE = CollapsingMergeTree(sign) PARTITION BY toYYYYMM(timestamp) -- Data will be split by month
ORDER BY (block_number, transaction_index, instruction_address);

{{/contracts}}
`

export function renderClickhouse({ contracts }: CustomTemplateParams) {
  return Mustache.render(customContractChTemplate, {
    contracts: getContractWithDbTypes(programTables(contracts)),
  })
}

function getContractWithDbTypes(tables: ProgramTable[]) {
  return tables.map(({ instruction, table }) => ({
    event: instruction.name,
    tableName: table,
    inputs: instruction.inputs.map((i) => ({
      name: toSnakeCase(i.name),
      dbType: svmToClickhouseType(i.type),
    })),
  }))
}
