import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { CustomTemplateParams } from '../template.config.js'

interface Program {
  contractName: string
  contractAddress: string
  contractEvents: Array<{ name: string }>
  range: { from: string; to?: string }
}

interface DecoderGroup {
  decoderId: string
  rangeFrom: string
  rangeTo?: string
  programs: Program[]
  instructions: Array<{ contractName: string; name: string; uniqueKey: string }>
}

export const customContractTemplate = `import { solanaInstructionDecoder } from '@subsquid/pipes/solana'
{{#decoderGroups}}
{{#programs}}
import { instructions as {{{contractName}}}Instructions } from "./contracts/{{{contractAddress}}}/index.js"
{{/programs}}
{{/decoderGroups}}
import { enrichEvents } from './utils/index.js'

{{#decoderGroups}}
const {{{decoderId}}} = solanaInstructionDecoder({
  range: { from: '{{{rangeFrom}}}'{{#rangeTo}}, to: '{{{rangeTo}}}'{{/rangeTo}} },
  programId: [
    {{#programs}}
    "{{{contractAddress}}}",
    {{/programs}}
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
{{/decoderGroups}}
`

export function buildDecoderGroups(params: CustomTemplateParams): DecoderGroup[] {
  const programs: Program[] = params.contracts.map((c) => ({
    contractName: toCamelCase(c.contractName),
    contractAddress: c.contractAddress,
    contractEvents: c.contractEvents,
    range: c.range ?? { from: 'latest' },
  }))

  if (programs.length === 0) return []

  const allSameRange = programs.every(
    (p) => p.range.from === programs[0]!.range.from && p.range.to === programs[0]!.range.to,
  )

  if (allSameRange && programs.length > 0) {
    return [makeGroup('custom', programs)]
  }

  return programs.map((p) => {
    const suffix = p.contractName.charAt(0).toUpperCase() + p.contractName.slice(1)
    return makeGroup(`custom${suffix}`, [p])
  })
}

function makeGroup(decoderId: string, programs: Program[]): DecoderGroup {
  const range = programs[0]!.range
  const instructions = programs.flatMap((p) =>
    p.contractEvents.map((e) => ({ contractName: p.contractName, name: e.name })),
  )
  const nameCounts = new Map<string, number>()
  for (const i of instructions) nameCounts.set(i.name, (nameCounts.get(i.name) ?? 0) + 1)
  const instructionsWithKeys = instructions.map((i) => ({
    ...i,
    uniqueKey: (nameCounts.get(i.name) ?? 0) > 1 ? `${i.contractName}${i.name}` : i.name,
  }))
  return {
    decoderId,
    rangeFrom: range.from,
    rangeTo: range.to,
    programs,
    instructions: instructionsWithKeys,
  }
}

export function renderTransformer(params: CustomTemplateParams): string {
  const decoderGroups = buildDecoderGroups(params)
  return Mustache.render(customContractTemplate, { decoderGroups })
}
