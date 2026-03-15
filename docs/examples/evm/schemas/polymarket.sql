-- =============================================================================
-- Polymarket Analytics Schema
-- =============================================================================
-- This schema processes Polymarket's OrdersMatched events from the CTF Exchange
-- contract on Polygon. It tracks prediction market trading activity and
-- identifies potential insider traders based on aggressive buying patterns.
--
-- Data flow:
--   OrdersMatched events -> `orders` table -> reducers -> materialized views
--
-- The schema defines three layers:
--   1. `orders`              - raw order data ingested from on-chain events
--   2. Reducers              - stateful Lua processors that run per-row,
--                              grouped by a key, maintaining persistent state
--   3. Materialized views    - pre-aggregated read-optimized query tables
-- =============================================================================


-- =============================================================================
-- Layer 1: Raw Data
-- =============================================================================

-- Virtual table that receives decoded OrdersMatched events from the pipe.
-- Each row represents a single matched order on the Polymarket CTF Exchange.
-- The `transform` function in the TypeScript pipe maps event fields to these columns.
CREATE VIRTUAL TABLE orders (
    block_number UInt64,    -- Block in which the order was matched
    timestamp    UInt64,    -- Unix timestamp (seconds) of the block
    trader       String,    -- Address of the taker (the one who filled the order)
    asset_id     String,    -- Polymarket condition token ID (identifies the outcome)
    usdc         UInt64,    -- USDC amount in raw units (6 decimals, so 1_000_000 = $1)
    shares       UInt64,    -- Number of outcome shares exchanged
    side         UInt64     -- 0 = buy, 1 = sell
);


-- =============================================================================
-- Layer 2: Reducers (stateful stream processors)
-- =============================================================================

-- Reducer: market_stats
-- Processes every order and emits per-trade statistics for each asset.
-- Grouped by asset_id, so each outcome token has its own persistent state.
-- State tracks running totals; emitted rows feed into `token_summary`.
CREATE REDUCER market_stats
SOURCE orders
GROUP BY asset_id
STATE (
    volume      Float64 DEFAULT 0,  -- Cumulative USDC volume in dollars
    trades      UInt64  DEFAULT 0,  -- Total number of trades
    sum_price   Float64 DEFAULT 0,  -- Running sum of prices (for mean calculation)
    sum_price_sq Float64 DEFAULT 0, -- Running sum of price^2 (for variance calculation)
    first_seen  UInt64  DEFAULT 0,  -- Timestamp of the first trade
    last_seen   UInt64  DEFAULT 0   -- Timestamp of the most recent trade
)
LANGUAGE lua
PROCESS $$
    -- Skip zero-share orders (division by zero guard)
    if row.shares == 0 then return end

    -- Price per share (USDC/shares ratio, both in raw units)
    local price = row.usdc / row.shares
    -- Convert raw USDC to dollars (6 decimal places)
    local vol = row.usdc / 1000000

    -- Update running state for this asset_id
    state.volume = state.volume + vol
    state.trades = state.trades + 1
    state.sum_price = state.sum_price + price
    state.sum_price_sq = state.sum_price_sq + price * price
    if state.first_seen == 0 then state.first_seen = row.timestamp end
    state.last_seen = row.timestamp

    -- Emit a row for each trade (consumed by the materialized view below)
    emit = {
        asset_id = row.asset_id,
        volume = vol,
        price = price,
        price_sq = price * price
    }
$$;


-- =============================================================================
-- Layer 3: Materialized Views (pre-aggregated query tables)
-- =============================================================================

-- Aggregates market_stats emissions into a per-token summary.
-- Provides total volume, trade count, last price, and values needed to
-- compute mean price (sum_price / trade_count) and price variance
-- (sum_price_sq / trade_count - mean^2) at query time.
CREATE MATERIALIZED VIEW token_summary AS
SELECT
    asset_id,
    sum(volume)    AS total_volume,   -- Total USDC volume in dollars
    count()        AS trade_count,    -- Number of trades
    last(price)    AS last_price,     -- Most recent trade price
    sum(price)     AS sum_price,      -- For computing average price
    sum(price_sq)  AS sum_price_sq    -- For computing price variance
FROM market_stats
GROUP BY asset_id;


-- =============================================================================
-- Layer 2 (cont.): Insider Detection Reducer
-- =============================================================================

-- Reducer: insider_classifier
-- Heuristic detector for potential insider trading on Polymarket.
-- Grouped by trader address - each trader gets independent state.
--
-- Detection logic:
--   1. Only considers BUY orders (side == 0) at low prices (< 95 cents),
--      since insiders typically buy cheap outcome tokens before news breaks.
--   2. Opens a 15-minute observation window starting from the trader's first
--      qualifying order.
--   3. If the trader accumulates >= $4,000 USDC volume within that window,
--      they are classified as "insider" and all their buffered positions are
--      emitted. All future qualifying orders are emitted immediately.
--   4. If 15 minutes pass without hitting the threshold, the trader is
--      classified as "clean" and permanently ignored.
--
-- This is a simple heuristic - not definitive proof of insider activity.
CREATE REDUCER insider_classifier
SOURCE orders
GROUP BY trader
STATE (
    status       String  DEFAULT 'unknown',  -- 'unknown' | 'insider' | 'clean'
    window_start UInt64  DEFAULT 0,          -- Start of the 15-min observation window
    window_vol   UInt64  DEFAULT 0,          -- Cumulative raw USDC in the window
    window_trades UInt64 DEFAULT 0,          -- Trade count in the window
    positions    JSON    DEFAULT '{}'         -- Buffered per-token position data (JSON map)
)
LANGUAGE lua
PROCESS $$
    -- Skip zero-share orders
    if row.shares == 0 then return end

    local FIFTEEN_MIN = 900               -- 15 minutes in seconds
    local VOLUME_THRESHOLD = 4000000000   -- $4,000 in raw USDC (6 decimals)
    local MIN_PRICE_BPS = 9500            -- 95 cents in basis points (95%)
    local BPS_SCALE = 10000

    -- Filter: only BUY orders (side == 0)
    if row.side ~= 0 then return end
    -- Filter: only "cheap" buys where price < 0.95
    -- Equivalent to: (usdc / shares) < 0.95, rearranged to avoid floating point
    if row.usdc * BPS_SCALE >= row.shares * MIN_PRICE_BPS then return end

    -- If already classified, either emit (insider) or skip (clean)
    if state.status ~= "unknown" then
        if state.status == "insider" then
            local price = row.usdc / row.shares
            emit = {
                trader = row.trader,
                asset_id = row.asset_id,
                volume = row.usdc / 1000000,
                price = price,
                price_sq = price * price,
                timestamp = row.timestamp,
                detected_at = row.timestamp
            }
        end
        return
    end

    -- Observation window management
    if state.window_start == 0 then
        -- First qualifying order - start the window
        state.window_start = row.timestamp
    elseif row.timestamp - state.window_start > FIFTEEN_MIN then
        -- Window expired without hitting threshold - trader is clean
        state.status = "clean"
        return
    end

    -- Accumulate volume within the observation window
    state.window_vol = state.window_vol + row.usdc
    state.window_trades = state.window_trades + 1

    -- Buffer per-token position data (held in JSON state)
    local token = row.asset_id
    local price = row.usdc / row.shares
    local vol = row.usdc / 1000000
    local pos = state.positions[token]
    if not pos then
        pos = { volume = 0, trades = 0, sum_price = 0, sum_price_sq = 0,
                first_seen = row.timestamp, last_seen = row.timestamp }
    end
    pos.volume = pos.volume + vol
    pos.trades = pos.trades + 1
    pos.sum_price = pos.sum_price + price
    pos.sum_price_sq = pos.sum_price_sq + price * price
    if row.timestamp < pos.first_seen then pos.first_seen = row.timestamp end
    if row.timestamp > pos.last_seen then pos.last_seen = row.timestamp end
    state.positions[token] = pos

    -- Check if trader crossed the volume threshold - classify as insider
    if state.window_vol >= VOLUME_THRESHOLD then
        state.status = "insider"
        -- Flush all buffered positions as emissions
        for tid, p in pairs(state.positions) do
            emit = {
                trader = row.trader,
                asset_id = tid,
                volume = p.volume,
                price = p.sum_price / p.trades,
                price_sq = p.sum_price_sq / p.trades,
                timestamp = p.first_seen,
                detected_at = row.timestamp
            }
        end
    end
$$;

-- Aggregates insider_classifier emissions into a per-trader, per-token view.
-- Shows each suspected insider's positions with volume, trade count, price
-- statistics, activity timespan, and when they were first flagged.
CREATE MATERIALIZED VIEW insider_positions AS
SELECT
    trader,
    asset_id,
    sum(volume)      AS total_volume,    -- Total USDC volume in dollars
    count()          AS trade_count,     -- Number of qualifying trades
    sum(price)       AS sum_price,       -- For computing average price
    sum(price_sq)    AS sum_price_sq,    -- For computing price variance
    first(timestamp) AS first_seen,      -- Earliest trade timestamp
    last(timestamp)  AS last_seen,       -- Latest trade timestamp
    first(detected_at) AS detected_at    -- When the trader was flagged as insider
FROM insider_classifier
GROUP BY trader, asset_id;