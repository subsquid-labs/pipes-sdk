import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { CustomTemplateParams } from '../template.config.js'

export const customContractTemplate = `import { solanaInstructionDecoder } from '@subsquid/pipes/solana'
{{#contracts}}
import { instructions as {{{contractName}}}Instructions } from "./contracts/{{{contractAddress}}}/index.js"
{{/contracts}}
import { enrichEvents } from './utils/index.js'

const custom = solanaInstructionDecoder({
  range: { from: '{{{rangeFrom}}}'{{#rangeTo}}, to: '{{{rangeTo}}}'{{/rangeTo}} },
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
    {{#instructions}}
    {{uniqueKey}}: {{contractName}}Instructions.{{name}},
    {{/instructions}}
  },
}).pipe(enrichEvents)
`

export function renderTransformer(params: CustomTemplateParams) {
  // For SVM, use the oldest (smallest block number) range across all contracts
  const ranges = params.contracts.map((c) => c.range).filter(Boolean)
  const range = ranges.reduce((oldest, r) => {
    if (!r) return oldest
    const a = Number(oldest.from)
    const b = Number(r.from)
    if (isNaN(b)) return oldest
    if (isNaN(a)) return r
    return b < a ? r : oldest
  }, ranges[0] ?? { from: 'latest' })

  const contractsWithCamelName = params.contracts.map((c) => ({ ...c, contractName: toCamelCase(c.contractName) }))

  const instructions = contractsWithCamelName.flatMap((c) =>
    c.contractEvents.map((e) => ({ contractName: c.contractName, name: e.name })),
  )
  const nameCounts = new Map<string, number>()
  for (const i of instructions) nameCounts.set(i.name, (nameCounts.get(i.name) ?? 0) + 1)
  const instructionsWithKeys = instructions.map((i) => ({
    ...i,
    uniqueKey: (nameCounts.get(i.name) ?? 0) > 1 ? `${i.contractName}${i.name}` : i.name,
  }))

  return Mustache.render(customContractTemplate, {
    rangeFrom: range.from,
    rangeTo: range.to,
    contracts: contractsWithCamelName,
    instructions: instructionsWithKeys,
  })
}
