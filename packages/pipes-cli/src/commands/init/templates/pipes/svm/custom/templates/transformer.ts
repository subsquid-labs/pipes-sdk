import Mustache from 'mustache'

import { flattenContracts } from '../../../../contract-params.js'
import { CustomTemplateParams } from '../template.config.js'
import { programIdentifiers } from './naming.js'

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
  const flat = flattenContracts(params.contracts)
  if (flat.length === 0) {
    return []
  }

  const identifiers = programIdentifiers(flat)

  const programs: Program[] = flat.map((c) => ({
    contractName: identifiers.get(c.typegenAddress)!,
    contractAddress: c.contractAddress,
    typegenAddress: c.typegenAddress,
    contractEvents: c.contractEvents,
    range: c.range ?? { from: 'latest' },
  }))

  // One decoder per (program, range). Deployments of the same program share its IDL and
  // discriminators, so they belong together in one decoder's programId array. Different
  // programs must never share a decoder: Solana discriminators are program-independent, so
  // two programs with a same-named instruction would decode each other's data (the decoder
  // now rejects that config at runtime). Keyed by typegen address so name normalization can't
  // merge distinct programs.
  const groups = new Map<string, Program[]>()
  for (const p of programs) {
    const key = `${p.typegenAddress}|${p.range.from}|${p.range.to ?? ''}`
    const list = groups.get(key) ?? []
    list.push(p)
    groups.set(key, list)
  }

  const groupList = [...groups.values()]
  if (groupList.length === 1) {
    return [makeGroup('custom', groupList[0]!)]
  }

  const usedIds = new Set<string>()
  return groupList.map((deployments) => {
    const name = deployments[0]!.contractName
    const suffix = name.charAt(0).toUpperCase() + name.slice(1)
    let decoderId = `custom${suffix}`
    for (let n = 2; usedIds.has(decoderId); n++) {
      decoderId = `custom${suffix}${n}`
    }
    usedIds.add(decoderId)

    return makeGroup(decoderId, deployments)
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
