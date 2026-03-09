import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'
import { metricsServer } from '@subsquid/pipes/metrics/node'
import { createPublicClient, erc20Abi, formatUnits, http } from 'viem'
import { mainnet } from 'viem/chains'

/**
 * Using viem RPC calls inside a Pipes pipeline.
 *
 * Three patterns are demonstrated:
 * 1. readContract — fetch token metadata (name, symbol, decimals) with in-memory cache
 * 2. readContract + blockNumber — read historical on-chain state at a specific block
 * 3. multicall — batch multiple RPC reads into a single round-trip
 */

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const USDC_DECIMALS = 6

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.drpc.org'),
})

// ─── Pattern 1: readContract with cache ──────────────────────────────────────

const tokenCache = new Map<string, { name: string; symbol: string; decimals: number }>()

async function getTokenMetadata(address: `0x${string}`) {
  const cached = tokenCache.get(address)
  if (cached) return cached

  const [name, symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'name' }).catch(() => 'Unknown'),
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }).catch(() => '???'),
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
  ])

  const metadata = { name, symbol, decimals }
  tokenCache.set(address, metadata)
  return metadata
}

// ─── Pattern 2: readContract at a specific block ─────────────────────────────

async function getBalancesAtBlock(transfer: { event: { from: string; to: string }; block: { number: number } }) {
  const [balanceFrom, balanceTo] = await Promise.all([
    client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [transfer.event.from as `0x${string}`],
      blockNumber: BigInt(transfer.block.number),
    }),
    client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [transfer.event.to as `0x${string}`],
      blockNumber: BigInt(transfer.block.number),
    }),
  ])

  return {
    from: formatUnits(balanceFrom, USDC_DECIMALS),
    to: formatUnits(balanceTo, USDC_DECIMALS),
  }
}

// ─── Pattern 3: multicall for batch reads ────────────────────────────────────

const MULTICALL_CHUNK_SIZE = 100

async function fetchTokenMetadataBatch(addresses: `0x${string}`[]) {
  for (let start = 0; start < addresses.length; start += MULTICALL_CHUNK_SIZE) {
    const chunk = addresses.slice(start, start + MULTICALL_CHUNK_SIZE)

    const contracts = chunk.flatMap(
      (address) =>
        [
          { address, abi: erc20Abi, functionName: 'name' },
          { address, abi: erc20Abi, functionName: 'symbol' },
          { address, abi: erc20Abi, functionName: 'decimals' },
        ] as const,
    )

    const results = await client.multicall({ contracts, allowFailure: true })

    for (let i = 0; i < chunk.length; i++) {
      const name = results[i * 3]
      const symbol = results[i * 3 + 1]
      const decimals = results[i * 3 + 2]

      tokenCache.set(chunk[i], {
        name: name.status === 'success' ? (name.result as string) : 'Unknown',
        symbol: symbol.status === 'success' ? (symbol.result as string) : '???',
        decimals: decimals.status === 'success' ? (decimals.result as number) : 18,
      })
    }
  }
}

// ─── Example 1: Enrich any ERC20 transfers with token metadata (sequential) ─

async function enrichmentExample() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    outputs: evmDecoder({
      range: { from: 'latest' },
      events: { transfers: commonAbis.erc20.events.Transfer },
    }),
    metrics: metricsServer(),
  }).pipe(async (data) => {
    const enriched = []
    for (const transfer of data.transfers) {
      const token = await getTokenMetadata(transfer.contract as `0x${string}`)
      enriched.push({
        block: transfer.block.number,
        from: transfer.event.from,
        to: transfer.event.to,
        value: transfer.event.value,
        token,
      })
    }
    return enriched
  })

  for await (const { data } of stream) {
    for (const t of data) {
      console.log(
        `#${t.block} ${t.token?.symbol ?? '???'}: ${t.from} → ${t.to} (${formatUnits(t.value, t.token.decimals)})`,
      )
    }
  }
}

// ─── Example 2: Read USDC balances at the block of each transfer ─────────────

async function contractStateExample() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    outputs: evmDecoder({
      range: { from: 'latest' },
      contracts: [USDC],
      events: { transfers: commonAbis.erc20.events.Transfer },
    }),
  }).pipe(async (data) => {
    const results = []
    for (const transfer of data.transfers) {
      const balances = await getBalancesAtBlock(transfer)
      results.push(
        { block: transfer.block.number, walletAddress: transfer.event.from, balance: balances.from },
        { block: transfer.block.number, walletAddress: transfer.event.to, balance: balances.to },
      )
    }
    return results
  })

  for await (const { data } of stream) {
    for (const r of data) {
      console.log(`#${r.block} ${r.walletAddress} balance: ${r.balance} USDC`)
    }
  }
}

// ─── Example 3: Enrich transfers with token metadata via multicall (batch) ───

async function multicallExample() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    outputs: evmDecoder({
      range: { from: 'latest' },
      events: { transfers: commonAbis.erc20.events.Transfer },
    }),
    metrics: metricsServer(),
  }).pipe(async (data) => {
    const uncached = [...new Set(data.transfers.map((t) => t.contract))].filter(
      (addr) => !tokenCache.has(addr),
    ) as `0x${string}`[]

    if (uncached.length > 0) {
      await fetchTokenMetadataBatch(uncached)
    }

    return data.transfers.map((transfer) => ({
      block: transfer.block.number,
      from: transfer.event.from,
      to: transfer.event.to,
      value: transfer.event.value,
      token: tokenCache.get(transfer.contract),
    }))
  })

  for await (const { data } of stream) {
    console.log(`--- batch: ${data.length} transfers, ${tokenCache.size} tokens cached ---`)
    for (const t of data.slice(0, 10)) {
      console.log(`  ${t.token?.symbol ?? '???'}: ${t.from} → ${t.to} (${t.value})`)
    }
  }
}

// ─── Run one of the examples ─────────────────────────────────────────────────

void enrichmentExample()
// void contractStateExample()
// void multicallExample()
