import { SubstrateQueryBuilder, substratePortalSource } from '@subsquid/pipes/substrate'

// Bittensor staking reward data per wallet, per era/epoch (2025)
// Tracks StakeAdded events which fire when rewards auto-compound at epoch end

// ~Jan 1 2025 on Bittensor (12s block time, ~7200 blocks/day)
const START_BLOCK = 4_670_000
// Bittensor epoch = 360 blocks (~72 minutes)
const EPOCH_LENGTH = 360

interface StakingReward {
  blockNumber: number
  timestamp: number | undefined
  epoch: number
  coldkey: string
  taoAmount: string
  hotkey: string | undefined
  alphaAmount: string | undefined
  netuid: number | undefined
}

// In-memory storage: wallet (coldkey) -> epoch -> rewards[]
const rewardsByWalletAndEpoch = new Map<string, Map<number, StakingReward[]>>()

// Summary stats
let totalRewards = 0
let totalWallets = new Set<string>()

function getEpoch(blockNumber: number): number {
  return Math.floor(blockNumber / EPOCH_LENGTH)
}

function storeReward(reward: StakingReward) {
  const walletRewards = rewardsByWalletAndEpoch.get(reward.coldkey) ?? new Map<number, StakingReward[]>()
  const epochRewards = walletRewards.get(reward.epoch) ?? []
  epochRewards.push(reward)
  walletRewards.set(reward.epoch, epochRewards)
  rewardsByWalletAndEpoch.set(reward.coldkey, walletRewards)

  totalRewards++
  totalWallets.add(reward.coldkey)

  console.log(Object.fromEntries(walletRewards))
}

async function main() {
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
          name: [
            'SubtensorModule.StakeAdded',
          ],
        },
      }),
    progress: {
      interval: 10_000,
    },
  })

  let lastLogBlock = 0

  for await (const { data, ctx } of stream) {
    for (const block of data.blocks) {
      const blockNumber = block.header.number
      const timestamp = block.header.timestamp
      const epoch = getEpoch(blockNumber)

      for (const event of block.events) {
        if (event.name !== 'SubtensorModule.StakeAdded') continue

        const args = event.args as any

        const params = args.length === 2
          ? ({
            coldkey: args[0],
            taoAmount: args[1]
          }) : ({
            coldkey: args[0],
            hotkey: args[1],
            taoAmount: String(args[2]),
            alphaAmount: String(args[3]),
            netuid: Number(args[4]),
          })

        // if (args.length > 2)
          console.log(args)

        // StakeAdded args: (coldkey, hotkey, tao_amount, alpha_amount, netuid, block)
        const reward: StakingReward = {
          blockNumber,
          timestamp,
          epoch,
          coldkey: params.coldkey,
          hotkey: params.hotkey,
          taoAmount: params.taoAmount,
          alphaAmount: params.alphaAmount,
          netuid: params.netuid
        }

        storeReward(reward)
      }

      // Log progress every 100k blocks
      if (blockNumber - lastLogBlock >= 100_000) {
        console.log(
          `[Block ${blockNumber}] Rewards: ${totalRewards} | Wallets: ${totalWallets.size} | Epochs: ${epoch}`
        )
        lastLogBlock = blockNumber
      }
    }
  }

  // Print summary
  console.log('\n=== Bittensor Staking Rewards Summary (2025) ===')
  console.log(`Total reward events: ${totalRewards}`)
  console.log(`Unique wallets (coldkeys): ${totalWallets.size}`)
  console.log(`Epochs covered: ${getEpoch(START_BLOCK)} - latest`)
  console.log(`Data stored in memory: rewardsByWalletAndEpoch (Map)`)

  // Example: print top 5 wallets by reward count
  const walletCounts = [...rewardsByWalletAndEpoch.entries()]
    .map(([wallet, epochs]) => {
      let count = 0
      for (const rewards of epochs.values()) count += rewards.length
      return { wallet, count }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  console.log('\nTop 5 wallets by reward frequency:')
  for (const { wallet, count } of walletCounts) {
    console.log(`  ${wallet}: ${count} rewards`)
  }
}

void main()
