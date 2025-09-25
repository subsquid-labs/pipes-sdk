import { PortalRange, parsePortalRange } from '@sqd-pipes/pipes'
import { createEvmDecoder } from '@sqd-pipes/pipes/evm'
import { events } from '../contracts/erc20'

export type Erc20Event = {
  from: string
  to: string
  amount: bigint
  token_address: string
  timestamp: Date
}

export function erc20Transfers({ range, contracts }: { range?: PortalRange; contracts?: string[] } = {}) {
  return createEvmDecoder({
    profiler: { id: 'erc20_transfers' },
    range: parsePortalRange(range || { from: 'latest' }),
    contracts,
    events: {
      transfers: events.Transfer,
    },
  }).pipe({
    profiler: { id: 'rename_fields' },
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
