import * as fs from 'node:fs'

import { ApiPromise, WsProvider } from '@polkadot/api'
import { SubstrateQueryBuilder, substratePortalSource } from '@subsquid/pipes/substrate'

// Bittensor Real Staking Rewards Calculator
//
// Approach:
// 1. Stream StakeAdded/StakeRemoved events from Portal → track manual operations per (coldkey, hotkey, netuid)
// 2. At epoch boundaries, query alpha balances via archive RPC
// 3. reward = alpha_balance_end - alpha_balance_start - net_manual_alpha_changes
// 4. Convert alpha → TAO via subnet AMM reserves, TAO → USD via CoinGecko
//
// Requires archive RPC node (public: wss://archive.chain.opentensor.ai:443)

const BITTENSOR_RPC = process.env['BITTENSOR_RPC'] ?? 'wss://archive.chain.opentensor.ai:443'
const PORTAL_URL = 'https://portal.sqd.dev/datasets/bittensor'
const EPOCH_LENGTH = 360 // 360 blocks (~72 minutes)
const REWARDS_CSV = 'bittensor-rewards-2025.csv'
const MAX_POSITIONS = Number(process.env['MAX_POSITIONS'] ?? 50)
const RAO_PER_TAO = 1_000_000_000

// ── Types ────────────────────────────────────────────────────────────

type StakeKey = `${string}:${string}:${number}` // coldkey:hotkey:netuid

interface EpochManualOps {
  alphaAdded: bigint
  alphaRemoved: bigint
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeKey(coldkey: string, hotkey: string, netuid: number): StakeKey {
  return `${coldkey}:${hotkey}:${netuid}`
}

function parseKey(key: StakeKey) {
  const parts = key.split(':')
  return { coldkey: parts[0], hotkey: parts[1], netuid: Number(parts[2]) }
}

function getEpoch(blockNumber: number): number {
  return Math.floor(blockNumber / EPOCH_LENGTH)
}

function epochBounds(epoch: number) {
  return { start: epoch * EPOCH_LENGTH, end: (epoch + 1) * EPOCH_LENGTH - 1 }
}

// ── CoinGecko TAO/USD ───────────────────────────────────────────────

async function fetchTaoUsdPrice(): Promise<number> {
  console.log('Fetching TAO/USD price from CoinGecko...')
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bittensor&vs_currencies=usd',
    )
    if (!res.ok) throw new Error(`${res.status}`)
    const data = (await res.json()) as { bittensor: { usd: number } }
    const price = data.bittensor.usd
    console.log(`TAO/USD: $${price}`)
    return price
  } catch (e: any) {
    console.warn(`CoinGecko error: ${e.message} — using $0`)
    return 0
  }
}

// ── RPC ─────────────────────────────────────────────────────────────

async function connectRpc(): Promise<ApiPromise> {
  console.log(`Connecting to RPC: ${BITTENSOR_RPC}`)
  const provider = new WsProvider(BITTENSOR_RPC)
  const api = await ApiPromise.create({ provider })
  const head = (await api.rpc.chain.getHeader()).number.toNumber()
  console.log(`Connected to Bittensor, head block: ${head}`)
  return api
}

async function queryAlpha(
  api: ApiPromise,
  blockHash: string,
  hotkey: string,
  coldkey: string,
  netuid: number,
): Promise<bigint> {
  try {
    const apiAt = await api.at(blockHash)
    // @ts-ignore - dynamic substrate storage
    const result = await apiAt.query.subtensorModule.alpha(hotkey, coldkey, netuid)
    const json = result.toJSON() as { bits: string | number }
    // U64F64 fixed-point: integer part = bits >> 64
    return BigInt(json.bits) >> 64n
  } catch {
    return 0n
  }
}

/** Query subnet AMM reserves → alpha/TAO price */
async function queryAlphaTaoPrice(
  api: ApiPromise,
  blockHash: string,
  netuid: number,
): Promise<number> {
  try {
    const apiAt = await api.at(blockHash)
    // @ts-ignore
    const alphaIn = await apiAt.query.subtensorModule.subnetAlphaIn(netuid)
    // @ts-ignore
    const tao = await apiAt.query.subtensorModule.subnetTAO(netuid)

    const alphaInVal = BigInt(alphaIn.toString())
    const taoVal = BigInt(tao.toString())

    if (alphaInVal === 0n) return 0
    // price = TAO_reserve / Alpha_reserve (both in RAO-like units)
    return Number(taoVal) / Number(alphaInVal)
  } catch {
    return 0
  }
}

// ── CSV ─────────────────────────────────────────────────────────────

function initCsv() {
  fs.writeFileSync(
    REWARDS_CSV,
    'epoch,block_start,block_end,coldkey,hotkey,netuid,reward_alpha,alpha_tao_price,reward_tao,tao_usd_price,reward_usd\n',
  )
}

function appendCsvRow(row: {
  epoch: number
  coldkey: string
  hotkey: string
  netuid: number
  rewardAlpha: bigint
  alphaTaoPrice: number
  rewardTao: number
  taoUsdPrice: number
  rewardUsd: number
}) {
  const { start, end } = epochBounds(row.epoch)
  const line = [
    row.epoch,
    start,
    end,
    row.coldkey,
    row.hotkey,
    row.netuid,
    row.rewardAlpha.toString(),
    row.alphaTaoPrice.toFixed(12),
    row.rewardTao.toFixed(9),
    row.taoUsdPrice.toFixed(2),
    row.rewardUsd.toFixed(4),
  ].join(',')
  fs.appendFileSync(REWARDS_CSV, `${line}\n`)
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const [api, taoUsdPrice] = await Promise.all([connectRpc(), fetchTaoUsdPrice()])
  const headBlock = (await api.rpc.chain.getHeader()).number.toNumber()

  const NUM_EPOCHS = Number(process.env['NUM_EPOCHS'] ?? 3)
  const safeEndBlock = headBlock - 2000
  const endEpoch = getEpoch(safeEndBlock) - 1
  const startEpoch = endEpoch - NUM_EPOCHS + 1
  const fromBlock = epochBounds(startEpoch).start
  const toBlock = epochBounds(endEpoch).end

  console.log(`\nProcessing ${NUM_EPOCHS} epochs: ${startEpoch}..${endEpoch}`)
  console.log(`Block range: ${fromBlock}..${toBlock} (safe margin from head ${headBlock})`)

  // ── Step 1: Collect manual stake operations from Portal ───────────
  console.log('\n[Step 1] Streaming stake events from Portal...')

  const stream = substratePortalSource({
    portal: PORTAL_URL,
    query: new SubstrateQueryBuilder()
      .addFields({
        block: { number: true },
        event: { name: true, args: true, extrinsicIndex: true },
      })
      .addEvent({ range: { from: fromBlock, to: toBlock }, request: { name: ['SubtensorModule.StakeAdded'] } })
      .addEvent({ range: { from: fromBlock, to: toBlock }, request: { name: ['SubtensorModule.StakeRemoved'] } }),
  })

  const manualOps = new Map<string, EpochManualOps>()
  const positionActivity = new Map<StakeKey, number>()

  function getOps(stakeKey: StakeKey, epoch: number): EpochManualOps {
    const k = `${stakeKey}|${epoch}`
    let ops = manualOps.get(k)
    if (!ops) {
      ops = { alphaAdded: 0n, alphaRemoved: 0n }
      manualOps.set(k, ops)
    }
    return ops
  }

  let stakeAddedCount = 0
  let stakeRemovedCount = 0

  for await (const { data } of stream) {
    for (const block of data.blocks) {
      const epoch = getEpoch(block.header.number)
      for (const event of block.events) {
        if (event.extrinsicIndex == null) continue
        const args = event.args as any[]
        if (args.length < 5) continue

        const coldkey = args[0] as string
        const hotkey = args[1] as string
        const alphaAmount = BigInt(args[3])
        const netuid = Number(args[4])
        const key = makeKey(coldkey, hotkey, netuid)

        positionActivity.set(key, (positionActivity.get(key) ?? 0) + 1)

        if (event.name === 'SubtensorModule.StakeAdded') {
          getOps(key, epoch).alphaAdded += alphaAmount
          stakeAddedCount++
        } else {
          getOps(key, epoch).alphaRemoved += alphaAmount
          stakeRemovedCount++
        }
      }
    }
  }

  console.log(`  StakeAdded: ${stakeAddedCount}, StakeRemoved: ${stakeRemovedCount}`)
  console.log(`  Unique positions: ${positionActivity.size}`)

  const topPositions = [...positionActivity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_POSITIONS)
    .map(([key]) => key)

  console.log(`  Selected top ${topPositions.length} positions for reward calculation`)

  // ── Step 2: Query balances + AMM prices → calculate rewards ───────
  console.log('\n[Step 2] Querying alpha balances & AMM prices at epoch boundaries...')

  initCsv()

  // Pre-fetch block hashes
  const blockHashes = new Map<number, string>()
  for (let epoch = startEpoch; epoch <= endEpoch; epoch++) {
    const { start, end } = epochBounds(epoch)
    for (const bn of [start, end]) {
      if (!blockHashes.has(bn)) {
        const hash = await api.rpc.chain.getBlockHash(bn)
        blockHashes.set(bn, hash.toString())
      }
    }
  }

  // Collect unique netuids for price queries
  const netuids = new Set(topPositions.map((k) => parseKey(k).netuid))

  let totalRewardTao = 0
  let totalRewardUsd = 0
  let positionsWithRewards = 0

  for (let epoch = startEpoch; epoch <= endEpoch; epoch++) {
    const { start, end } = epochBounds(epoch)
    const startHash = blockHashes.get(start)!
    const endHash = blockHashes.get(end)!

    // Query alpha/TAO price per subnet at epoch end
    const alphaPrices = new Map<number, number>()
    for (const netuid of netuids) {
      alphaPrices.set(netuid, await queryAlphaTaoPrice(api, endHash, netuid))
    }

    let epochTao = 0
    let epochUsd = 0
    let epochCount = 0

    for (let i = 0; i < topPositions.length; i++) {
      const key = topPositions[i]
      const { coldkey, hotkey, netuid } = parseKey(key)

      const alphaStart = await queryAlpha(api, startHash, hotkey, coldkey, netuid)
      const alphaEnd = await queryAlpha(api, endHash, hotkey, coldkey, netuid)

      const ops = manualOps.get(`${key}|${epoch}`)
      const added = ops?.alphaAdded ?? 0n
      const removed = ops?.alphaRemoved ?? 0n

      const rewardAlpha = alphaEnd - alphaStart - added + removed

      if (rewardAlpha > 0n) {
        const alphaTaoPrice = alphaPrices.get(netuid) ?? 0
        const rewardTao = Number(rewardAlpha) * alphaTaoPrice / RAO_PER_TAO
        const rewardUsd = rewardTao * taoUsdPrice

        epochTao += rewardTao
        epochUsd += rewardUsd
        epochCount++

        appendCsvRow({
          epoch,
          coldkey,
          hotkey,
          netuid,
          rewardAlpha,
          alphaTaoPrice,
          rewardTao,
          taoUsdPrice,
          rewardUsd,
        })
      }

      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r  Epoch ${epoch}: ${i + 1}/${topPositions.length} positions queried...`)
      }
    }

    totalRewardTao += epochTao
    totalRewardUsd += epochUsd
    positionsWithRewards += epochCount
    console.log(
      `\r  Epoch ${epoch} (${start}..${end}): ${epochCount} positions, ${epochTao.toFixed(4)} TAO, $${epochUsd.toFixed(2)}`,
    )
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log('\n=== Summary ===')
  console.log(`Epochs: ${NUM_EPOCHS} (${startEpoch}..${endEpoch})`)
  console.log(`Positions analyzed: ${topPositions.length}`)
  console.log(`Positions with rewards: ${positionsWithRewards}`)
  console.log(`Total rewards: ${totalRewardTao.toFixed(4)} TAO ($${totalRewardUsd.toFixed(2)})`)
  console.log(`TAO/USD: $${taoUsdPrice.toFixed(2)}`)
  console.log(`CSV: ${REWARDS_CSV}`)

  await api.disconnect()
}

void main()
