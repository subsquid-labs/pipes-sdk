# Bittensor Staking Rewards: Feasibility Assessment

## 1. Data Feasibility

### 1.1 Staking Rewards

**Status: Confirmed — data is available and extractable.**

POC script (`docs/examples/substrate/02.bittensor-staking-rewards.example.ts`) successfully streams `SubtensorModule.StakeAdded` events from Subsquid Portal API. Staking reward events are distinguished from manual stakes by the absence of `extrinsicIndex` — rewards are emitted by the runtime at epoch boundaries, not from user transactions.

Event format varies by chain version:

| Format | Parameters | Period |
|--------|-----------|--------|
| Legacy (2-param) | `(coldkey, tao_amount)` | Before subnet upgrade |
| Current (5-param) | `(coldkey, hotkey, tao_amount, alpha_amount, netuid)` | After subnet upgrade |

Both formats are handled in the POC. Each event yields:
- **coldkey** — wallet address receiving rewards
- **epoch** — derived from block number (`floor(block / 360)`, ~72 min per epoch)
- **tao_amount** — reward in Rao (1 TAO = 10^9 Rao)
- **hotkey, netuid** — validator and subnet info (new format only)

### 1.2 TAO/USD Price

| Provider | Granularity | Historical range | Price | Notes |
|----------|------------|------------------|-------|-------|
| **Binance API** | 1m / 1h / 1d | From listing (2023) | Free | Single-exchange price, not aggregated |
| **CryptoCompare** | hourly / daily (free); minute — 7 days | Full history | Free (hourly/daily) | Aggregated across exchanges |
| **CoinGecko Demo** | daily (ranges >90 days) | Last 365 days | Free (30 req/min, 10K/mo) | Demo API key required |
| **CoinGecko Analyst** | hourly | Full history | $129/mo | Full historical access |
| **CoinMarketCap Startup** | hourly / daily | Full history | $79/mo | No free historical data |
| **CoinAPI Startup** | Arbitrary | Full history | $79/mo | Aggregated from 400+ exchanges |

**Recommendation:** Binance API for production (free, daily granularity sufficient for daily reward USD valuation). CryptoCompare as fallback for aggregated prices.

Daily granularity is sufficient for this use case — staking rewards are distributed per epoch (~72 min), but USD valuation at daily resolution is standard practice for reporting.

## 2. Data Range

- **Portal dataset:** `bittensor` at `https://portal.sqd.dev/datasets/bittensor`
- **Current height:** ~7,528,000+ blocks
- **Block 4,670,000** (~January 9, 2025): confirmed available, POC streams from this point
- **Full 2025 coverage:** confirmed — blocks 4,670,000 through current head are accessible
- **Bittensor block time:** 12 seconds (~7,200 blocks/day)
- **Stream throughput:** ~1,500 blocks/second (observed in POC), full 2025 takes ~30 min

**Note:** The dataset does not provide real-time head streaming (Portal shows a warning). Data lags behind the chain head. For one-shot or monthly delivery this is acceptable.

**Action item:** Confirm with Network team whether blocks prior to 4,670,000 (before January 2025) are available in the Portal dataset, in case the client needs earlier history.

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
| Finalize indexing script (edge cases, validation, error handling) | 2-3 days |
| Database schema + target integration (Drizzle/PostgreSQL or ClickHouse) | 1-2 days |
| Price feed integration (Binance or CryptoCompare API) | 1 day |
| Full 2025 data ingestion run + validation | 1 day |
| Data export in client format (CSV/JSON from DB) | 0.5 day |
| **Total** | **5-7 working days** |

### What exists today

- Working POC script that streams all StakeAdded events from Jan 2025, enriches with CoinGecko daily prices, writes detailed + summary CSVs
- Substrate Portal source and query builder integrated into the SDK
- Database targets (ClickHouse, Drizzle/PostgreSQL) available in the SDK

### What remains

- Replace CSV output with database target (`pipeTo`)
- Switch price source from CoinGecko to Binance API (free, no key needed for historical klines)
- Add data validation (cross-check total rewards, epoch continuity)
- Production error handling (retry logic, checkpoint resume)

## Appendix: POC Results

POC script location: `docs/examples/substrate/02.bittensor-staking-rewards.example.ts`

Run command:
```bash
COINGECKO_API_KEY=<key> pnpm tsx docs/examples/substrate/02.bittensor-staking-rewards.example.ts
```

Output files:
- `bittensor-rewards-2025.csv` — all reward events with columns: `epoch, block_number, timestamp, coldkey, hotkey, tao_amount, alpha_amount, netuid, tao_usd_price, reward_usd_value`
- `bittensor-rewards-summary-2025.csv` — per-wallet aggregation: `coldkey, total_rewards, total_tao, total_usd_value, first_epoch, last_epoch, unique_hotkeys`

Sample output (first rows):
```
epoch,block_number,timestamp,coldkey,hotkey,tao_amount,...,tao_usd_price,reward_usd_value
12972,4670000,2025-01-09T23:14:24.001Z,0x84d83d...,,2.200000000,...,402.0622,884.5367
12972,4670011,2025-01-09T23:16:36.000Z,0x82cca2...,,5.071067990,...,402.0622,2038.8845
```

Observed throughput: ~1,500 blocks/second, ETA for full 2025: ~30 minutes.
