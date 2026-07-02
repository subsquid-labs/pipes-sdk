CREATE TABLE IF NOT EXISTS token_balances (
    block_number UInt64,
    block_hash String,
    block_time UInt64,
    token_address String,
    owner String,
    amount Float64
) ENGINE = ReplacingMergeTree()
ORDER BY (block_number, token_address, owner);