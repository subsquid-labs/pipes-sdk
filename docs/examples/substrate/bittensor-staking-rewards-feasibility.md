# Bittensor Staking Rewards: Feasibility Assessment

## 1. Data Feasibility

### 1.1 Staking Rewards

**Status: Confirmed — data is available and extractable via hybrid Portal + archive RPC approach.**

Bittensor does NOT emit per-staker reward events. The `drain_pending_emission` function (Yuma Consensus) directly updates alpha balances in storage without emitting individual reward events. All `SubtensorModule.StakeAdded` events have an `extrinsicIndex` — they represent manual user stakes only, not reward distributions.

**Approach:** Calculate rewards as the difference between on-chain alpha balances at epoch boundaries, minus manual stake operations:

```
reward = alpha_balance_end - alpha_balance_start - manual_alpha_added + manual_alpha_removed
```

This requires two data sources:
1. **Subsquid Portal** — streams `StakeAdded` / `StakeRemoved` events to track manual operations per (coldkey, hotkey, netuid)
2. **Archive RPC** — queries `subtensorModule.alpha(hotkey, coldkey, netuid)` at epoch boundary blocks for actual balances

POC script (`docs/examples/substrate/02.bittensor-staking-rewards.example.ts`) implements this approach end-to-end with alpha → TAO → USD conversion.

### 1.2 On-chain Data Details

**StakeAdded/StakeRemoved event format (post-dTAO):**

| Param | Type | Description |
|-------|------|-------------|
| coldkey | AccountId | Wallet address |
| hotkey | AccountId | Validator key |
| tao_amount | u64 | TAO spent/received (in Rao) |
| alpha_amount | u64 | Alpha tokens staked/unstaked |
| netuid | u16 | Subnet ID |

**Alpha balance storage:**
- `subtensorModule.alpha(hotkey, coldkey, netuid)` → `U64F64` (128-bit fixed-point, integer part = `bits >> 64`)

**Alpha → TAO conversion via subnet AMM:**
- `subtensorModule.subnetTAO(netuid)` / `subtensorModule.subnetAlphaIn(netuid)` = TAO price per alpha at any historical block

### 1.3 TAO/USD Price

| Provider | Granularity | Historical range | Price | Notes |
|----------|------------|------------------|-------|-------|
| **CoinGecko (free)** | current spot | N/A | Free (no key) | `/simple/price` endpoint |
| **Binance API** | 1m / 1h / 1d | From listing (2023) | Free | Single-exchange price, not aggregated |
| **CryptoCompare** | hourly / daily (free); minute — 7 days | Full history | Free (hourly/daily) | Aggregated across exchanges |
| **CoinGecko Demo** | daily (ranges >90 days) | Last 365 days | Free (30 req/min, 10K/mo) | Demo API key required |
| **CoinGecko Analyst** | hourly | Full history | $129/mo | Full historical access |

**Recommendation:** CoinGecko free for current price (sufficient for near-real-time reporting). Binance API for historical daily prices (free, no key needed).

## 2. Infrastructure Requirements

### 2.1 Portal

- **Dataset:** `bittensor` at `https://portal.sqd.dev/datasets/bittensor`
- **Current height:** ~7,556,000+ blocks
- **Full 2025 coverage confirmed:** block 4,600,000 (Dec 31, 2024) through current head. No gaps.
- **Bittensor block time:** 12 seconds (~7,200 blocks/day)
- **Lag:** ~600 blocks behind chain head (~2 hours)
- **Stream throughput:** ~1,500 blocks/second
- **Limitation:** Event streaming only, no state/storage queries

### 2.2 Archive RPC

- **Public archive:** `wss://archive.chain.opentensor.ai:443` — full historical state, free
- **Public lite:** `wss://entrypoint-finney.opentensor.ai:443` — only ~256 blocks of state (NOT sufficient)
- **Important:** Archive RPC is required for historical balance queries. Portal and lite RPC alone cannot calculate rewards.

### 2.3 Timing Constraint

Portal lags ~600 blocks behind head. Archive RPC has full history. When processing, use a block range with safe margin: `headBlock - 2000` as the end point to ensure Portal data is available.

## 3. Alternative Data Providers

No existing provider offers a turnkey solution for per-wallet, per-epoch, USD-denominated Bittensor staking rewards.

| Provider | Bittensor support | Per-wallet per-epoch rewards | USD denomination | Format |
|----------|:-:|:-:|:-:|--------|
| **TAO Stats** (taostats.io) | Yes | Partial — aggregate views, no granular export | Current price only | Dashboard, limited API |
| **Subscan** (bittensor.subscan.io) | Yes | Partial — events/extrinsics browsable | Current price only | Dashboard, REST API, CSV |
| **SubQuery** | Yes (Substrate native) | Possible with custom project | No (external price join needed) | GraphQL API |
| **Dune Analytics** | No (no Substrate) | — | — | — |
| **The Graph** | No (no Substrate) | — | — | — |
| **Nansen** | No | — | — | — |
| **Flipside** | No | — | — | — |

**Key takeaway:** The market has a clear gap. Dune, The Graph, Nansen, and Flipside do not support Substrate chains. TAO Stats and Subscan have partial Bittensor data but lack exportable, historically-USD-denominated per-wallet reward breakdowns. Building this with Subsquid Pipes SDK fills a genuine gap.

## 4. Estimates

### Scenario: One-shot delivery with database

Deliver complete 2025 staking rewards data indexed into a database (PostgreSQL or ClickHouse), queryable by wallet/epoch, with USD valuation.

| Phase | Effort |
|-------|--------|
| Optimize RPC query parallelization (batch queries, connection pooling) | 1-2 days |
| Database schema + target integration (Drizzle/PostgreSQL or ClickHouse) | 1-2 days |
| Historical price feed integration (Binance API) | 1 day |
| Full 2025 data ingestion run + validation | 1-2 days |
| Data export in client format (CSV/JSON from DB) | 0.5 day |
| **Total** | **5-8 working days** |

### What exists today

- Working POC script with full pipeline: Portal events → archive RPC balance queries → alpha/TAO AMM price → TAO/USD → CSV
- Tested on real data: 2 epochs, 10 positions → 49.63 TAO ($9,371.74) in rewards
- Substrate Portal source and query builder integrated into the SDK
- Database targets (ClickHouse, Drizzle/PostgreSQL) available in the SDK
- SDK fix for `extrinsicIndex: null` validation (substrate events without extrinsic)

### What remains

- Replace CSV output with database target (`pipeTo`)
- Optimize RPC throughput (current: ~20 queries/sec sequential; need: parallel batch queries for thousands of positions)
- Switch to historical daily TAO/USD prices (Binance klines API)
- Add data validation (cross-check totals, epoch continuity)
- Production error handling (retry logic, checkpoint resume)

## Appendix: POC Results

POC script location: `docs/examples/substrate/02.bittensor-staking-rewards.example.ts`

Run command:
```bash
# Process 2 epochs, top 10 most active positions
NUM_EPOCHS=2 MAX_POSITIONS=10 pnpm tsx docs/examples/substrate/02.bittensor-staking-rewards.example.ts

# Full run (3 epochs, top 50 positions)
pnpm tsx docs/examples/substrate/02.bittensor-staking-rewards.example.ts

# Custom archive RPC
BITTENSOR_RPC=wss://your-archive-node:443 pnpm tsx docs/examples/substrate/02.bittensor-staking-rewards.example.ts
```

Output file: `bittensor-rewards-2025.csv`

Columns: `epoch, block_start, block_end, coldkey, hotkey, netuid, reward_alpha, alpha_tao_price, reward_tao, tao_usd_price, reward_usd`

Sample output:
```
epoch,block_start,block_end,coldkey,hotkey,netuid,reward_alpha,alpha_tao_price,reward_tao,tao_usd_price,reward_usd
20981,7553160,7553519,0x387153...,0xbc0e6b...,127,790935611452,0.005700703337,4.508889279,188.83,851.4136
20981,7553160,7553519,0xc49e79...,0xbc0e6b...,64,30704646759,0.102294722496,3.140923320,188.83,593.1006
20981,7553160,7553519,0xd69107...,0x58aef7...,0,5411752276,4.315713080188,23.355570084,188.83,4410.2323
```

Summary (2 epochs, 10 positions): **49.63 TAO ($9,371.74)** in staking rewards.
