import * as fs from 'node:fs'

import { SubstrateQueryBuilder, substratePortalSource } from '@subsquid/pipes/substrate'

// Bittensor Staking Rewards with USD prices (2025)
// Streams StakeAdded events, enriches with TAO/USD daily price from CoinGecko,
// writes two CSV files: detailed rewards and per-wallet summary.

const START_BLOCK = 4_670_000 // ~Jan 1 2025 on Bittensor
const EPOCH_LENGTH = 360 // 360 blocks (~72 minutes)
const RAO_PER_TAO = 1_000_000_000n

const REWARDS_CSV = 'bittensor-rewards-2025.csv'
const SUMMARY_CSV = 'bittensor-rewards-summary-2025.csv'

// ── CoinGecko price fetching ─────────────────────────────────────────

async function fetchTaoPrices(): Promise<Map<string, number>> {
  const apiKey = process.env.COINGECKO_API_KEY
  if (!apiKey) {
    console.warn('COINGECKO_API_KEY not set — USD prices will be 0. Set env var to enable price enrichment.')
    return new Map()
  }

  const url = 'https://api.coingecko.com/api/v3/coins/bittensor/market_chart?vs_currency=usd&days=365&interval=daily'

  console.log('Fetching TAO/USD prices from CoinGecko...')
  const res = await fetch(url, {
    headers: { 'x-cg-demo-api-key': apiKey },
  })
  if (!res.ok) {
    console.warn(`CoinGecko API error: ${res.status} ${res.statusText} — USD prices will be 0`)
    return new Map()
  }

  const data = (await res.json()) as { prices: [number, number][] }
  const priceMap = new Map<string, number>()

  for (const [timestampMs, price] of data.prices) {
    const date = new Date(timestampMs).toISOString().slice(0, 10)
    priceMap.set(date, price)
  }

  console.log(`Loaded ${priceMap.size} daily prices (${[...priceMap.keys()][0]} to ${[...priceMap.keys()].at(-1)})`)
  return priceMap
}

function findPrice(priceMap: Map<string, number>, timestampMs: number): number {
  const date = new Date(timestampMs).toISOString().slice(0, 10)
  const price = priceMap.get(date)
  if (price != null) return price

  // Fallback: find nearest available date
  const dates = [...priceMap.keys()].sort()
  let closest = dates[0]
  for (const d of dates) {
    if (d <= date) closest = d
    else break
  }
  return priceMap.get(closest) ?? 0
}

// ── CSV helpers ──────────────────────────────────────────────────────

function escapeCSV(value: string | number | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function initRewardsCSV() {
  fs.writeFileSync(
    REWARDS_CSV,
    'epoch,block_number,timestamp,coldkey,hotkey,tao_amount,alpha_amount,netuid,tao_usd_price,reward_usd_value\n',
  )
}

function appendRewardRow(row: {
  epoch: number
  blockNumber: number
  timestamp: string
  coldkey: string
  hotkey: string
  taoAmount: string
  alphaAmount: string
  netuid: string
  taoUsdPrice: number
  rewardUsdValue: number
}) {
  const line = [
    row.epoch,
    row.blockNumber,
    escapeCSV(row.timestamp),
    escapeCSV(row.coldkey),
    escapeCSV(row.hotkey),
    row.taoAmount,
    row.alphaAmount,
    escapeCSV(row.netuid),
    row.taoUsdPrice.toFixed(4),
    row.rewardUsdValue.toFixed(4),
  ].join(',')
  fs.appendFileSync(REWARDS_CSV, `${line}\n`)
}

// ── Summary tracking ─────────────────────────────────────────────────

interface WalletSummary {
  totalRewards: number
  totalTaoRao: bigint
  totalUsdValue: number
  firstEpoch: number
  lastEpoch: number
  hotkeys: Set<string>
}

const summaryByWallet = new Map<string, WalletSummary>()

function updateSummary(coldkey: string, epoch: number, taoRao: bigint, usdValue: number, hotkey: string) {
  let s = summaryByWallet.get(coldkey)
  if (!s) {
    s = {
      totalRewards: 0,
      totalTaoRao: 0n,
      totalUsdValue: 0,
      firstEpoch: epoch,
      lastEpoch: epoch,
      hotkeys: new Set(),
    }
    summaryByWallet.set(coldkey, s)
  }
  s.totalRewards++
  s.totalTaoRao += taoRao
  s.totalUsdValue += usdValue
  if (epoch < s.firstEpoch) s.firstEpoch = epoch
  if (epoch > s.lastEpoch) s.lastEpoch = epoch
  if (hotkey) s.hotkeys.add(hotkey)
}

function writeSummaryCSV() {
  const header = 'coldkey,total_rewards,total_tao,total_usd_value,first_epoch,last_epoch,unique_hotkeys\n'
  const rows = [...summaryByWallet.entries()]
    .sort((a, b) => b[1].totalUsdValue - a[1].totalUsdValue)
    .map(([coldkey, s]) => {
      const totalTao = Number(s.totalTaoRao) / Number(RAO_PER_TAO)
      return [
        escapeCSV(coldkey),
        s.totalRewards,
        totalTao.toFixed(9),
        s.totalUsdValue.toFixed(4),
        s.firstEpoch,
        s.lastEpoch,
        s.hotkeys.size,
      ].join(',')
    })
  fs.writeFileSync(SUMMARY_CSV, header + rows.join('\n') + '\n')
}

// ── Main pipeline ────────────────────────────────────────────────────

function getEpoch(blockNumber: number): number {
  return Math.floor(blockNumber / EPOCH_LENGTH)
}

function raoToTao(rao: bigint): number {
  return Number(rao) / Number(RAO_PER_TAO)
}

async function main() {
  const priceMap = await fetchTaoPrices()

  initRewardsCSV()

  const stream = substratePortalSource({
    portal: 'https://portal.sqd.dev/datasets/bittensor',
    query: new SubstrateQueryBuilder()
      .addFields({
        block: { number: true, hash: true, timestamp: true },
        event: { name: true, args: true, extrinsicIndex: true },
      })
      .addEvent({
        range: { from: START_BLOCK },
        request: {
          name: ['SubtensorModule.StakeAdded'],
        },
      }),
    progress: {
      interval: 10_000,
    },
  })

  let totalEvents = 0
  let lastLogBlock = 0

  for await (const { data } of stream) {
    for (const block of data.blocks) {
      const blockNumber = block.header.number
      const timestamp = block.header.timestamp
      const epoch = getEpoch(blockNumber)

      for (const event of block.events) {
        if (event.name !== 'SubtensorModule.StakeAdded') continue
        // Skip manual stakes — rewards have no associated extrinsic
        if (event.extrinsicIndex != null) continue

        const args = event.args as any[]

        let rec: { coldkey: string; hotkey: string; taoRao: bigint; alphaAmount: string; netuid: string }
        if (args.length === 2) {
          // Legacy format: (coldkey, tao_amount)
          rec = { coldkey: args[0], hotkey: '', taoRao: BigInt(args[1]), alphaAmount: '', netuid: '' }
        } else if (args.length >= 5) {
          // Current format: (coldkey, hotkey, tao_amount, alpha_amount, netuid)
          rec = {
            coldkey: args[0],
            hotkey: args[1],
            taoRao: BigInt(args[2]),
            alphaAmount: String(args[3]),
            netuid: String(args[4]),
          }
        } else {
          console.warn(`Unexpected StakeAdded args (length=${args.length}):`, args)
          continue
        }

        const taoAmount = raoToTao(rec.taoRao)
        const taoUsdPrice = timestamp ? findPrice(priceMap, timestamp) : 0
        const rewardUsdValue = taoAmount * taoUsdPrice

        appendRewardRow({
          epoch,
          blockNumber,
          timestamp: timestamp ? new Date(timestamp).toISOString() : '',
          coldkey: rec.coldkey,
          hotkey: rec.hotkey,
          taoAmount: taoAmount.toFixed(9),
          alphaAmount: rec.alphaAmount,
          netuid: rec.netuid,
          taoUsdPrice,
          rewardUsdValue,
        })

        updateSummary(rec.coldkey, epoch, rec.taoRao, rewardUsdValue, rec.hotkey)
        totalEvents++
      }

      if (blockNumber - lastLogBlock >= 100_000) {
        console.log(
          `[Block ${blockNumber}] Events: ${totalEvents} | Wallets: ${summaryByWallet.size} | Epoch: ${epoch}`,
        )
        lastLogBlock = blockNumber
      }
    }
  }

  // Write summary
  writeSummaryCSV()

  console.log('\n=== POC Complete ===')
  console.log(`Total StakeAdded events: ${totalEvents}`)
  console.log(`Unique wallets: ${summaryByWallet.size}`)
  console.log(`Rewards CSV: ${REWARDS_CSV}`)
  console.log(`Summary CSV: ${SUMMARY_CSV}`)

  // Top 10 wallets by USD value
  const top = [...summaryByWallet.entries()].sort((a, b) => b[1].totalUsdValue - a[1].totalUsdValue).slice(0, 10)

  console.log('\nTop 10 wallets by USD value:')
  for (const [coldkey, s] of top) {
    const tao = Number(s.totalTaoRao) / Number(RAO_PER_TAO)
    console.log(
      `  ${coldkey.slice(0, 12)}... ${s.totalRewards} rewards, ${tao.toFixed(4)} TAO, $${s.totalUsdValue.toFixed(2)}`,
    )
  }
}

void main()
