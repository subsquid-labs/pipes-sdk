CREATE TABLE IF NOT EXISTS erc20_transfers (
    block_number UInt32,
    tx_hash String,
    log_index UInt16,
    timestamp DateTime(3),
    from String,
    to String,
    value UInt256,
    token_address String,
    sign Int8 DEFAULT 1
  )
  ENGINE = CollapsingMergeTree(sign)
  ORDER BY (block_number, tx_hash, log_index)