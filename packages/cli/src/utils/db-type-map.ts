import { NetworkType, Sink } from '~/types/init.js'

export class DbMappingError extends Error {
  constructor(networkType: NetworkType, sink: Sink, type: string) {
    let lang: string
    switch (networkType) {
      case 'evm':
        lang = 'Solidity'
        break
      case 'svm':
        lang = 'Rust'
        break
    }
    super(`Failed to map ${lang} to ${sink} type. Type ${type} doesn't have a correspondence in the mapping object`)
  }
}

export function evmToClickhouseType(type: string) {
  if (type in solidityToClickHouseTypes) {
    return solidityToClickHouseTypes[type as keyof typeof solidityToClickHouseTypes]
  }
  throw new DbMappingError('evm', 'clickhouse', type)
}

export function evmToPostgresType(type: string) {
  if (type in solidityToPostgresTypes) {
    return solidityToPostgresTypes[type as keyof typeof solidityToPostgresTypes]
  }
  throw new DbMappingError('evm', 'postgresql', type)
}

export function svmToClickhouseType(type: string) {
  if (type in svmToClickhouseTypes) {
    return svmToClickhouseTypes[type as keyof typeof svmToClickhouseTypes]
  }
  throw new DbMappingError('svm', 'clickhouse', type)
}

export function svmToPostgresType(type: string) {
  if (type in svmToPostgresTypes) {
    return svmToPostgresTypes[type as keyof typeof svmToPostgresTypes]
  }
  throw new DbMappingError('svm', 'postgresql', type)
}

function clickhouseBytesType(size: number) {
  return `FixedString(${size * 2 + 2})`
}

const CLICKHOUSE_INT_SIZES = [8, 16, 32, 64, 128, 256] as const

function smallestClickHouseSize(bits: number): (typeof CLICKHOUSE_INT_SIZES)[number] {
  const size = CLICKHOUSE_INT_SIZES.find((s) => s >= bits)
  return size ?? 256
}

function buildSolidityIntEntries<T>(
  prefix: 'uint' | 'int',
  toType: (bits: number) => T,
): Record<string, T> {
  const entries: Record<string, T> = {}
  for (let bits = 8; bits <= 256; bits += 8) {
    entries[`${prefix}${bits}`] = toType(bits)
  }
  entries[prefix] = toType(256) // uint → uint256, int → int256
  return entries
}

const solidityToClickHouseTypes = {
  ...buildSolidityIntEntries('uint', (bits) => `UInt${smallestClickHouseSize(bits)}` as const),
  ...buildSolidityIntEntries('int', (bits) => `Int${smallestClickHouseSize(bits)}` as const),

  // Boolean
  bool: 'Bool',

  // Address
  address: 'LowCardinality(FixedString(42))',

  tuple: 'JSON',

  // Fixed-size bytes
  bytes1: clickhouseBytesType(1),
  bytes2: clickhouseBytesType(2),
  bytes3: clickhouseBytesType(3),
  bytes4: clickhouseBytesType(4),
  bytes5: clickhouseBytesType(5),
  bytes6: clickhouseBytesType(6),
  bytes7: clickhouseBytesType(7),
  bytes8: clickhouseBytesType(8),
  bytes9: clickhouseBytesType(9),
  bytes10: clickhouseBytesType(10),
  bytes11: clickhouseBytesType(11),
  bytes12: clickhouseBytesType(12),
  bytes13: clickhouseBytesType(13),
  bytes14: clickhouseBytesType(14),
  bytes15: clickhouseBytesType(15),
  bytes16: clickhouseBytesType(16),
  bytes17: clickhouseBytesType(17),
  bytes18: clickhouseBytesType(18),
  bytes19: clickhouseBytesType(19),
  bytes20: clickhouseBytesType(20),
  bytes21: clickhouseBytesType(21),
  bytes22: clickhouseBytesType(22),
  bytes23: clickhouseBytesType(23),
  bytes24: clickhouseBytesType(24),
  bytes25: clickhouseBytesType(25),
  bytes26: clickhouseBytesType(26),
  bytes27: clickhouseBytesType(27),
  bytes28: clickhouseBytesType(28),
  bytes29: clickhouseBytesType(29),
  bytes30: clickhouseBytesType(30),
  bytes31: clickhouseBytesType(31),
  bytes32: clickhouseBytesType(32),

  // Dynamic types
  bytes: 'String',
  string: 'String',
}

function postgresBytesType(size: number) {
  return `char({ length: ${size * 2 + 2} })`
}

function postgresNumericPrecision(bits: number): number {
  return Math.ceil((bits * Math.LN2) / Math.LN10)
}

function postgresUintType(bits: number): string {
  if (bits <= 8) return 'smallint()'
  if (bits <= 16) return 'integer()'
  if (bits <= 32) return "bigint({ mode: 'bigint' })"
  return `numeric({ precision: ${postgresNumericPrecision(bits)}, scale: 0 })`
}

function postgresIntType(bits: number): string {
  if (bits <= 16) return 'smallint()'
  if (bits <= 32) return 'integer()'
  if (bits <= 64) return "bigint({ mode: 'number' })"
  return `numeric({ precision: ${postgresNumericPrecision(bits)}, scale: 0 })`
}

const solidityToPostgresTypes = {
  ...buildSolidityIntEntries('uint', postgresUintType),
  ...buildSolidityIntEntries('int', postgresIntType),

  // Boolean
  bool: 'boolean()',

  tuple: 'jsonb()',

  // Address (0x + 40 hex)
  address: 'char({ length: 42 })',

  // Fixed-size bytes (0x + 2*N hex)
  bytes1: postgresBytesType(1),
  bytes2: postgresBytesType(2),
  bytes3: postgresBytesType(3),
  bytes4: postgresBytesType(4),
  bytes5: postgresBytesType(5),
  bytes6: postgresBytesType(6),
  bytes7: postgresBytesType(7),
  bytes8: postgresBytesType(8),
  bytes9: postgresBytesType(9),
  bytes10: postgresBytesType(10),
  bytes11: postgresBytesType(11),
  bytes12: postgresBytesType(12),
  bytes13: postgresBytesType(13),
  bytes14: postgresBytesType(14),
  bytes15: postgresBytesType(15),
  bytes16: postgresBytesType(16),
  bytes17: postgresBytesType(17),
  bytes18: postgresBytesType(18),
  bytes19: postgresBytesType(19),
  bytes20: postgresBytesType(20),
  bytes21: postgresBytesType(21),
  bytes22: postgresBytesType(22),
  bytes23: postgresBytesType(23),
  bytes24: postgresBytesType(24),
  bytes25: postgresBytesType(25),
  bytes26: postgresBytesType(26),
  bytes27: postgresBytesType(27),
  bytes28: postgresBytesType(28),
  bytes29: postgresBytesType(29),
  bytes30: postgresBytesType(30),
  bytes31: postgresBytesType(31),
  bytes32: postgresBytesType(32),

  // Dynamic types
  bytes: 'text()',
  string: 'text()',
} as const

// Solana program (Anchor/IDL-ish) -> ClickHouse types
// Notes:
// - pubkey = 32 bytes. If you store base58 strings instead, use LowCardinality(String).
// - i128/u128 aren’t native in JS but are common in Anchor types; ClickHouse supports Int128/UInt128.
// - "string"/"bytes"/Vec<u8> are best as String (for raw bytes you may want base64).
export const svmToClickhouseTypes = {
  // Integers
  u8: 'UInt8',
  u16: 'UInt16',
  u32: 'UInt32',
  u64: 'UInt64',
  u128: 'UInt128',

  i8: 'Int8',
  i16: 'Int16',
  i32: 'Int32',
  i64: 'Int64',
  i128: 'Int128',

  // Floats (rare in programs, but exist in Rust)
  f32: 'Float32',
  f64: 'Float64',

  // Boolean
  bool: 'Bool',

  // Pubkey / Address (raw 32 bytes)
  publicKey: 'FixedString(86)',

  // Common Solana primitives
  // unix timestamp in seconds (i64)
  unix_timestamp: 'Int64',
  // slot is u64
  slot: 'UInt64',
  // lamports is u64
  lamports: 'UInt64',

  // Bytes / strings
  bytes: 'String', // e.g. Vec<u8>
  string: 'String', // Rust String

  // Fixed-size byte arrays (Anchor often exposes these as "bytes" with length)
  bytes1: 'FixedString(1)',
  bytes2: 'FixedString(2)',
  bytes3: 'FixedString(3)',
  bytes4: 'FixedString(4)',
  bytes5: 'FixedString(5)',
  bytes6: 'FixedString(6)',
  bytes7: 'FixedString(7)',
  bytes8: 'FixedString(8)',
  bytes9: 'FixedString(9)',
  bytes10: 'FixedString(10)',
  bytes11: 'FixedString(11)',
  bytes12: 'FixedString(12)',
  bytes13: 'FixedString(13)',
  bytes14: 'FixedString(14)',
  bytes15: 'FixedString(15)',
  bytes16: 'FixedString(16)',
  bytes17: 'FixedString(17)',
  bytes18: 'FixedString(18)',
  bytes19: 'FixedString(19)',
  bytes20: 'FixedString(20)',
  bytes21: 'FixedString(21)',
  bytes22: 'FixedString(22)',
  bytes23: 'FixedString(23)',
  bytes24: 'FixedString(24)',
  bytes25: 'FixedString(25)',
  bytes26: 'FixedString(26)',
  bytes27: 'FixedString(27)',
  bytes28: 'FixedString(28)',
  bytes29: 'FixedString(29)',
  bytes30: 'FixedString(30)',
  bytes31: 'FixedString(31)',
  bytes32: 'FixedString(32)',
} as const

// Solana program (Anchor/IDL-ish) -> Postgres (drizzle) types
// Notes:
// - pubkey: if you store base58 (most common) it's up to 44 chars. If you store raw bytes, use bytea().
// - u64/i64 fit in 64-bit, but JS can’t represent all values safely; prefer bigint mode.
// - u128/i128 exceed 64-bit, so use numeric with precision 39, scale 0.
export const svmToPostgresTypes = {
  // Integers
  u8: 'smallint()',
  u16: 'integer()',
  u32: "bigint({ mode: 'bigint' })",
  u64: "numeric({ precision: 20, scale: 0, mode: 'bigint' })",
  u128: "numeric({ precision: 39, scale: 0, mode: 'bigint' })",

  i8: 'smallint()',
  i16: 'smallint()',
  i32: 'integer()',

  i64: "bigint({ mode: 'bigint' })",
  i128: 'numeric({ precision: 39, scale: 0 })',

  // Floats (rare in programs, but exist in Rust)
  f32: 'real()',
  f64: 'doublePrecision()',

  // Boolean
  bool: 'boolean()',

  // Pubkey / Address (base58)
  publicKey: 'varchar({ length: 44 })',

  // Common Solana primitives
  unix_timestamp: "bigint({ mode: 'bigint' })", // i64 seconds
  slot: "numeric({ precision: 20, scale: 0, mode: 'bigint' })", // u64
  lamports: "numeric({ precision: 20, scale: 0, mode: 'bigint' })", // u64

  // Bytes / strings
  bytes: 'bytea()', // e.g. Vec<u8>
  string: 'text()',

  // Fixed-size byte arrays (raw bytes)
  bytes1: 'bytea()',
  bytes2: 'bytea()',
  bytes3: 'bytea()',
  bytes4: 'bytea()',
  bytes5: 'bytea()',
  bytes6: 'bytea()',
  bytes7: 'bytea()',
  bytes8: 'bytea()',
  bytes9: 'bytea()',
  bytes10: 'bytea()',
  bytes11: 'bytea()',
  bytes12: 'bytea()',
  bytes13: 'bytea()',
  bytes14: 'bytea()',
  bytes15: 'bytea()',
  bytes16: 'bytea()',
  bytes17: 'bytea()',
  bytes18: 'bytea()',
  bytes19: 'bytea()',
  bytes20: 'bytea()',
  bytes21: 'bytea()',
  bytes22: 'bytea()',
  bytes23: 'bytea()',
  bytes24: 'bytea()',
  bytes25: 'bytea()',
  bytes26: 'bytea()',
  bytes27: 'bytea()',
  bytes28: 'bytea()',
  bytes29: 'bytea()',
  bytes30: 'bytea()',
  bytes31: 'bytea()',
  bytes32: 'bytea()',
} as const
