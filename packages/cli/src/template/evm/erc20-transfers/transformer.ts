import { commonAbis, evmDecoder } from '@subsquid/pipes/evm'

evmDecoder({
  profiler: { id: 'erc20-transfers' }, // Optional: add a profiler to measure the performance of the transformer
  range: { from: 'latest' },
  // Uncomment the line below to filter by contract addresses
  // contracts: ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"], // WETH on Ethereum mainnet
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
