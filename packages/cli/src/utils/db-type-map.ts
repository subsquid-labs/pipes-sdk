import { Sink } from '~/types/init.js'

export class SolidityMappingError extends Error {
  constructor(sink: Sink, type: string) {
    super(`Failed to map Solidity to ${sink} type. Type ${type} doesn't have a correspondence in the mapping object`)
  }
}

export function getClickhouseType(type: string) {
  if (type in solidityToClickHouseTypes) {
    return solidityToClickHouseTypes[type as keyof typeof solidityToClickHouseTypes]
  }

  throw new SolidityMappingError('clickhouse', type)
}

export function getPostgresType(type: string) {
  if (type in solidityToPostgresTypes) {
    return solidityToPostgresTypes[type as keyof typeof solidityToPostgresTypes]
  }

  throw new SolidityMappingError('postgresql', type)
}

const solidityToClickHouseTypes = {
  // Unsigned integers
  uint8: 'UInt8',
  uint16: 'UInt16',
  uint32: 'UInt32',
  uint64: 'UInt64',
  uint128: 'UInt128',
  uint256: 'UInt256',
  uint: 'UInt256',

  // Signed integers
  int8: 'Int8',
  int16: 'Int16',
  int32: 'Int32',
  int64: 'Int64',
  int128: 'Int128',
  int256: 'Int256',
  int: 'Int256',

  // Boolean
  bool: 'Bool',

  // Address
  address: 'LowCardinality(FixedString(42))',

  // Fixed-size bytes
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

  // Dynamic types
  bytes: 'String',
  string: 'String',
}

const solidityToPostgresTypes = {
  // Unsigned integers
  uint8: 'smallint()',
  uint16: 'integer()',
  uint32: "bigint({ mode: 'bigint' })",
  uint64: 'numeric({ precision: 20, scale: 0 })',
  uint128: 'numeric({ precision: 39, scale: 0 })',
  uint256: 'numeric({ precision: 78, scale: 0 })',
  uint: 'numeric({ precision: 78, scale: 0 })',

  // Signed integers
  int8: 'smallint()',
  int16: 'smallint()',
  int32: 'integer()',
  int64: "bigint({ mode: 'number' })",
  int128: 'numeric({ precision: 39, scale: 0 })',
  int256: 'numeric({ precision: 78, scale: 0 })',
  int: 'numeric({ precision: 78, scale: 0 })',

  // Boolean
  bool: 'boolean()',

  // Address (0x + 40 hex)
  address: 'char({ length: 42 })',

  // Fixed-size bytes (0x + 2*N hex)
  bytes1: 'char({ length: 4 })',
  bytes2: 'char({ length: 6 })',
  bytes3: 'char({ length: 8 })',
  bytes4: 'char({ length: 10 })',
  bytes5: 'char({ length: 12 })',
  bytes6: 'char({ length: 14 })',
  bytes7: 'char({ length: 16 })',
  bytes8: 'char({ length: 18 })',
  bytes9: 'char({ length: 20 })',
  bytes10: 'char({ length: 22 })',
  bytes11: 'char({ length: 24 })',
  bytes12: 'char({ length: 26 })',
  bytes13: 'char({ length: 28 })',
  bytes14: 'char({ length: 30 })',
  bytes15: 'char({ length: 32 })',
  bytes16: 'char({ length: 34 })',
  bytes17: 'char({ length: 36 })',
  bytes18: 'char({ length: 38 })',
  bytes19: 'char({ length: 40 })',
  bytes20: 'char({ length: 42 })',
  bytes21: 'char({ length: 44 })',
  bytes22: 'char({ length: 46 })',
  bytes23: 'char({ length: 48 })',
  bytes24: 'char({ length: 50 })',
  bytes25: 'char({ length: 52 })',
  bytes26: 'char({ length: 54 })',
  bytes27: 'char({ length: 56 })',
  bytes28: 'char({ length: 58 })',
  bytes29: 'char({ length: 60 })',
  bytes30: 'char({ length: 62 })',
  bytes31: 'char({ length: 64 })',
  bytes32: 'char({ length: 66 })',

  // Dynamic types
  bytes: 'text()',
  string: 'text()',
} as const
