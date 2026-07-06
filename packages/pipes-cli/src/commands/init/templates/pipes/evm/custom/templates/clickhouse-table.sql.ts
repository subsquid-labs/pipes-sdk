import { toSnakeCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { evmToClickhouseType } from '~/utils/db-type-map.js'

import { tableName } from '../../../../../builders/sink-builder/shared.js'
import { type DecoderGrouping } from '../decoder-grouping.js'

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
  {{#shared}}
  contract_address LowCardinality(FixedString(42)),
  {{/shared}}
  sign Int8  DEFAULT toInt8(1),
  INDEX _sqd_rollback_idx block_number TYPE minmax GRANULARITY 1
)
ENGINE = CollapsingMergeTree(sign) PARTITION BY toYYYYMM(timestamp) -- Data will be split by month
ORDER BY (block_number, tx_hash, log_index);

{{/contracts}}
`

export function renderClickhouse(grouping: DecoderGrouping) {
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
      tableName: tableName(grouping, group.contracts[0].contractName, e, group.events),
      shared: grouping.shared,
      inputs: e.inputs.map((i) => ({
        ...i,
        name: toSnakeCase(i.name),
        dbType: evmToClickhouseType(i.type),
      })),
    })),
  )
}
