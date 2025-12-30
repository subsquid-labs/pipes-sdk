CREATE TABLE IF NOT EXISTS uniswap_v3_swaps (
    block_number UInt32,
    tx_hash String,
    log_index UInt32,
    timestamp DateTime(3),
    pool_address String,
    token0 String,
    token1 String,
    fee UInt256,
    tick_spacing UInt256,
    sign Int8 DEFAULT 1
)
ENGINE = CollapsingMergeTree(sign)
ORDER BY (block_number, tx_hash, log_index)