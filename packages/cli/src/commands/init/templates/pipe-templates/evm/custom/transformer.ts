import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { ContractMetadata } from '~/services/sqd-abi.js'

export const customContractTemplate = `import { evmDecoder } from '@subsquid/pipes/evm'
{{#contracts}}
import { events as {{{contractName}}}Events } from "./contracts/{{{contractAddress}}}.js"
{{/contracts}}
import { enrichEvents } from './utils/index.js'

const custom = evmDecoder({
  range: { from: 'latest' },
  contracts: [
    {{#contracts}}
    "{{{contractAddress}}}",
    {{/contracts}}
  ],
  /**
   * Or optionally use pass all events object directly to listen to all contract events
   * \`\`\`ts
   * events: myContractEvents,
   * \`\`\`
   */
  events: {
    {{#contracts}}
    {{#contractEvents}}
    {{name}}: {{contractName}}Events.{{name}},
    {{/contractEvents}}
    {{/contracts}}
  },
}).pipe(enrichEvents)
`

interface TransformerTemplateParams {
  contracts: ContractMetadata[]
}

export function renderTransformerTemplate({ contracts }: TransformerTemplateParams) {
  return Mustache.render(customContractTemplate, {
    contracts: contracts.map((c) => ({ ...c, contractName: toCamelCase(c.contractName) })),
  })
}
