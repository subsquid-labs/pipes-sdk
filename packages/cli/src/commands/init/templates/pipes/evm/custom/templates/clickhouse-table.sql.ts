import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { evmToClickhouseType } from '~/utils/db-type-map.js'

import { type DecoderGrouping } from '../decoder-grouping.js'
import { CustomTemplateParams } from '../template.config.js'
import { groupContractsForDecoders } from '../decoder-grouping.js'

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
  timestamp DateTime CODEC (DoubleDelta, ZSTD),
  sign Int8  DEFAULT toInt8(1)
)
ENGINE = CollapsingMergeTree(sign) PARTITION BY toYYYYMM(timestamp) -- Data will be split by month
ORDER BY (block_number, tx_hash, log_index);

{{/contracts}}
`

function tableName(grouping: DecoderGrouping, contractName: string, eventName: string) {
  return grouping.shared ? toSnakeCase(eventName) : toSnakeCase(`${contractName}_${eventName}`)
}

export function renderClickhouse({ contracts }: CustomTemplateParams) {
  const grouping = groupContractsForDecoders(contracts)
  const contracsWithDbTypes = getContractWithDbTypes(grouping)

  return Mustache.render(customContractChTemplate, {
    contracts: contracsWithDbTypes,
  })
}

function getContractWithDbTypes(grouping: DecoderGrouping) {
  return grouping.groups.flatMap((group) =>
    group.events.map((e) => ({
      event: e.name,
      decoderId: group.decoderId,
      tableName: tableName(grouping, group.contracts[0].contractName, e.name),
      inputs: e.inputs.map((i) => ({
        ...i,
        name: toSnakeCase(i.name),
        dbType: evmToClickhouseType(i.type),
      })),
    })),
  )
}
