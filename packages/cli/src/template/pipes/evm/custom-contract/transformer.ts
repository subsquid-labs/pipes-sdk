import { evmDecoder } from '@subsquid/pipes/evm'

const customContract = evmDecoder({
  range: { from: 'latest' },
  contracts: [],
  events: {},
})
