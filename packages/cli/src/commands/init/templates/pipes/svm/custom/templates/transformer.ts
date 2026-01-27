import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'
import { CustomTemplateParams } from '../template.config.js'

export const customContractTemplate = `import { solanaInstructionDecoder } from '@subsquid/pipes/solana'
{{#contracts}}
import { instructions as {{{contractName}}}Instructions } from "./contracts/{{{contractAddress}}}/index.js"
{{/contracts}}
import { enrichEvents } from './utils/index.js'

const custom = solanaInstructionDecoder({
  range: { from: 'latest' },
  programId: [
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
  instructions: {
    {{#contracts}}
    {{#contractEvents}}
    {{name}}: {{contractName}}Instructions.{{name}},
    {{/contractEvents}}
    {{/contracts}}
  },
}).pipe(enrichEvents)
`

export function renderTransformer(params: CustomTemplateParams) {
  return Mustache.render(customContractTemplate, {
    contracts: params.contracts.map((c) => ({ ...c, contractName: toCamelCase(c.contractName) })),
  })
}
