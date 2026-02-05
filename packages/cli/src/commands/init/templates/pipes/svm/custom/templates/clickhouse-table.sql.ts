import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { ContractMetadata } from '~/services/sqd-abi.js'
import { svmToClickhouseType } from '~/utils/db-type-map.js'
import { CustomTemplateParams } from '../template.config.js'

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
  sign Int8  DEFAULT toInt8(1)
)
ENGINE = CollapsingMergeTree(sign) PARTITION BY toYYYYMM(timestamp) -- Data will be split by month
ORDER BY (block_number, transaction_index, instruction_address);

{{/contracts}}
`

export function renderClickhouse({ contracts }: CustomTemplateParams) {
  const contractsWithDbTypes = getContractWithDbTypes(contracts)

  return Mustache.render(customContractChTemplate, {
    contracts: contractsWithDbTypes,
  })
}

function getContractWithDbTypes(contracts: ContractMetadata[]) {
  return contracts.flatMap((c) =>
    c.contractEvents.map((e) => ({
      event: e.name,
      tableName: toSnakeCase(`${c.contractName}_${e.name}`),
      inputs: e.inputs.map((i) => ({
        name: toSnakeCase(i.name),
        dbType: svmToClickhouseType(i.type),
      })),
    })),
  )
}
