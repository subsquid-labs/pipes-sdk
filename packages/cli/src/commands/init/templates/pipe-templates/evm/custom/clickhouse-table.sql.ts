import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { ContractMetadata } from '~/services/sqd-abi.js'
import { getClickhouseType } from '~/utils/db-type-map.js'

export const customContractChTemplate = `
{{#contracts}}
CREATE TABLE IF NOT EXISTS {{tableName}} (
  -- Event params
  {{#inputs}}
  {{name}} {{dbType}},
  {{/inputs}}
  -- Event metadata
  block_number UInt32,
  tx_hash String,
  log_index UInt16,
  timestamp DateTime(3),
  sign Int8  DEFAULT toInt8(1)
)
ENGINE = CollapsingMergeTree(sign) PARTITION BY toYYYYMM(timestamp) -- Data will be split by month
ORDER BY (block_number, tx_hash, log_index);

{{/contracts}}
`

export interface CustomSchemaParams {
  contracts: ContractMetadata[]
}

export function renderCustomClickhouseTables({ contracts }: CustomSchemaParams) {
  const contracsWithDbTypes = getContractWithDbTypes(contracts)

  return Mustache.render(customContractChTemplate, {
    contracts: contracsWithDbTypes,
  })
}

function getContractWithDbTypes(contracts: ContractMetadata[]) {
  return contracts.flatMap((c) =>
    c.contractEvents.map((e) => ({
      event: e.name,
      tableName: toSnakeCase(`${c.contractName}_${e.name}`),
      inputs: e.inputs.map((i) => ({
        ...i,
        dbType: getClickhouseType(i.type),
      })),
    })),
  )
}
