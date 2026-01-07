CREATE TABLE IF NOT EXISTS custom_contract (
    block_number UInt32,
    tx_hash String,
    log_index UInt16,
    timestamp DateTime(3),
    -- Add here the columns for the custom contract events
  )
  ENGINE = MergeTree
  ORDER BY (block_number, tx_hash, log_index)