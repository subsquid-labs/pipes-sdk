import { toCamelCase } from 'drizzle-orm/casing'
import Mustache from 'mustache'

import { flattenContracts } from '../../../../contract-params.js'
import { CustomTemplateParams } from '../template.config.js'

interface Program {
  contractName: string
  contractAddress: string
  /** Reference-deployment address for the typegen import path. */
  typegenAddress: string
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
{{#imports}}
import { instructions as {{{alias}}}Instructions } from "./contracts/{{{address}}}/index.js"
{{/imports}}
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
  const programs: Program[] = flattenContracts(params.contracts).map((c) => ({
    contractName: toCamelCase(c.contractName),
    contractAddress: c.contractAddress,
    typegenAddress: c.typegenAddress,
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

  // One decoder per (program, deployment); same-name deployments get numeric suffixes.
  const usedIds = new Set<string>()
  return programs.map((p) => {
    const suffix = p.contractName.charAt(0).toUpperCase() + p.contractName.slice(1)
    let decoderId = `custom${suffix}`
    for (let n = 2; usedIds.has(decoderId); n++) decoderId = `custom${suffix}${n}`
    usedIds.add(decoderId)

    return makeGroup(decoderId, [p])
  })
}

function makeGroup(decoderId: string, programs: Program[]): DecoderGroup {
  const range = programs[0]!.range

  // Instructions are program-level: deployments of the same program share its
  // IDL, so only the first entry per program name contributes — otherwise a
  // multi-deployment program would emit duplicate instruction keys.
  const uniquePrograms = [...new Map(programs.map((p) => [p.contractName, p])).values()]
  const instructions = uniquePrograms.flatMap((p) =>
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

  // One typegen import per program, deduped across groups and deployments.
  const imports = new Map<string, string>()
  for (const group of decoderGroups) {
    for (const program of group.programs) {
      imports.set(program.contractName, program.typegenAddress)
    }
  }

  return Mustache.render(customContractTemplate, {
    decoderGroups,
    imports: [...imports].map(([alias, address]) => ({ alias, address })),
  })
}
