import Mustache from 'mustache'
import { Erc20TransferParams } from './template.config.js'

const template = `import { commonAbis, evmDecoder } from '@subsquid/pipes/evm'

const erc20Transfers = evmDecoder({
  profiler: { id: 'erc20-transfers' }, // Optional: add a profiler to measure the performance of the transformer
  range: { from: '12,369,621' },
  contracts: [
    {{#contractAddresses}}
    '{{.}}'
    {{/contractAddresses}}
  ],
  events: {
    transfers: commonAbis.erc20.events.Transfer,
  },
}).pipe(({ transfers }) =>
  transfers.map((transfer) => ({
    blockNumber: transfer.block.number,
    txHash: transfer.rawEvent.transactionHash,
    logIndex: transfer.rawEvent.logIndex,
    timestamp: transfer.timestamp.getTime(),
    from: transfer.event.from,
    to: transfer.event.to,
    value: transfer.event.value,
    tokenAddress: transfer.contract,
  })),
)
`

export function renderTransformer({ params }: Erc20TransferParams) {
  return Mustache.render(template, params)
}
