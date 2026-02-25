import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { CustomTemplateParams } from '../template.config.js'
import { groupContractsForDecoders } from '../decoder-grouping.js'

export const customContractTemplate = `import { evmDecoder } from '@subsquid/pipes/evm'
{{#decoderGroups}}
{{#imports}}
import { events as {{{alias}}} } from "./contracts/{{{address}}}.js"
{{/imports}}
{{/decoderGroups}}
import { enrichEvents } from './utils/index.js'

{{#decoderGroups}}
const {{{decoderId}}} = evmDecoder({
  range: { from: '{{{rangeFrom}}}'{{#rangeTo}}, to: '{{{rangeTo}}}'{{/rangeTo}} },
  contracts: [
    {{#contracts}}
    '{{{contractAddress}}}',
    {{/contracts}}
  ],
  /**
   * Or optionally use pass all events object directly to listen to all contract events
   * \`\`\`ts
   * events: myContractEvents,
   * \`\`\`
   */
  events: {
    {{#events}}
    {{name}}: {{{eventsAlias}}}.{{name}},
    {{/events}}
  },
}).pipe(enrichEvents)
{{/decoderGroups}}
`

export function renderTransformer({ contracts }: CustomTemplateParams) {
  const grouping = groupContractsForDecoders(contracts)

  const decoderGroups = grouping.groups.map((group) => {
    const firstContract = group.contracts[0]
    const alias = `${toCamelCase(firstContract.contractName)}Events`

    return {
      decoderId: group.decoderId,
      imports: [{ alias, address: firstContract.contractAddress }],
      contracts: group.contracts,
      rangeFrom: group.range.from,
      rangeTo: group.range.to,
      events: group.events.map((e) => ({
        name: e.name,
        eventsAlias: alias,
      })),
    }
  })

  return Mustache.render(customContractTemplate, { decoderGroups })
}
