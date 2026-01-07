CREATE TABLE IF NOT EXISTS custom_contract (
    block_number UInt64,
    block_hash String,
    transaction_index UInt32,
    instruction_address String,
    program_id String,
    accounts Array(String),
    data String,
    timestamp UInt64,
    -- Add here the columns for the custom contract instructions
)
ENGINE = MergeTree
ORDER BY (block_number, transaction_index, instruction_address)