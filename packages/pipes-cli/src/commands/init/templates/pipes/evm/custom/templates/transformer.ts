import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { uniqueEventKey } from '../../../../../builders/target-builder/shared.js'
import { type DecoderGrouping } from '../decoder-grouping.js'

export const customContractTemplate = `import { evmEventDecoder } from '@subsquid/pipes/evm'
{{#imports}}
import { events as {{{alias}}} } from "./contracts/{{{address}}}.js"
{{/imports}}
import { enrichEvents } from './utils/index.js'

{{#decoderGroups}}
const {{{decoderId}}} = evmEventDecoder({
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
    {{#overloaded}}
    // NOTE: "{{name}}" is overloaded in this ABI; evm-typegen exposes only the canonical variant, so additional signatures may not decode until upstream support lands.
    {{/overloaded}}
    {{uniqueKey}}: {{{eventsAlias}}}.{{name}},
    {{/events}}
  },
}).pipe(enrichEvents)
{{/decoderGroups}}
`

export function renderTransformer(grouping: DecoderGrouping) {
  // One typegen import per contract, even when its deployments split into several
  // decoder groups — imports are keyed by alias and deduped across groups.
  const imports = new Map<string, string>()

  const decoderGroups = grouping.groups.map((group) => {
    const firstContract = group.contracts[0]
    const alias = `${toCamelCase(firstContract.contractName)}Events`
    imports.set(alias, firstContract.typegenAddress ?? firstContract.contractAddress)

    return {
      decoderId: group.decoderId,
      contracts: group.contracts,
      rangeFrom: group.range.from,
      rangeTo: group.range.to,
      events: group.events.map((e) => {
        const uniqueKey = uniqueEventKey(e, group.events)
        return {
          name: e.name,
          uniqueKey,
          overloaded: uniqueKey !== e.name,
          eventsAlias: alias,
        }
      }),
    }
  })

  return Mustache.render(customContractTemplate, {
    decoderGroups,
    imports: [...imports].map(([alias, address]) => ({ alias, address })),
  })
}
