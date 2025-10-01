import { PortalRange, parsePortalRange } from '@sqd-pipes/pipes'
import { commonAbis, createEvmDecoder } from '@sqd-pipes/pipes/evm'

export type Erc20Event = {
  from: string
  to: string
  amount: bigint
  token_address: string
  timestamp: Date
}

export function erc20Transfers({ range, contracts }: { range?: PortalRange; contracts?: string[] } = {}) {
  return createEvmDecoder({
    profiler: { id: 'ERC20 transfers' },
    range: parsePortalRange(range || { from: 'latest' }),
    contracts,
    events: {
      transfers: commonAbis.erc20.events.Transfer,
    },
  }).pipe({
    profiler: { id: 'rename ields' },
    transform: async ({ transfers }) => {
      return transfers.map(
        ({ event, timestamp, contract }): Erc20Event => ({
          from: event.from,
          to: event.to,
          amount: event.value,
          token_address: contract,
          timestamp: timestamp,
        }),
      )
    },
  })
}
