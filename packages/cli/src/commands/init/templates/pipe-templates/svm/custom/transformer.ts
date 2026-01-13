export const customContractTemplate = `import { solanaInstructionDecoder } from '@subsquid/pipes/solana'
import { instructions as myProgramInstructions } from "./instructions/{{{address}}}.js"

const custom = solanaInstructionDecoder({
  range: { from: 'latest' },
  programId: [programId],
  instructions: {{{eventsAlias}}}, 
  /**
   * Or optionally use only a subset of events by passing the events object directly:
   * \`\`\`ts
   * instructions: {
   *   transfers: myProgramInstructions.instructions.Swap,
   * },
   * \`\`\`
   */
})
`