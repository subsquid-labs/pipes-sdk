/**
 * For this case we are using a Mustache template since we don't have the
 * contract address yet, and it will only be generated after the template is built.
 */
export const customContractTemplate = `import { evmDecoder } from '@subsquid/pipes/evm'
import { events as myContractEvents } from "./contracts/{{{address}}}.js"

const custom = evmDecoder({
  range: { from: 'latest' },
  contracts: ["{{{address}}}"],
  /**
   * Or optionally use only a subset of events by passing the events object directly:
   * \`\`\`ts
   * events: {
   *   transfers: myContractEvents.events.SomeEvent,
   * },
   * \`\`\`
   */
  events: myContractEvents,
})
`
