import { describe, expect, it } from 'vitest'

import { DbMappingError, evmToClickhouseType, evmToPostgresType } from './db-type-map.js'

describe('evmToPostgresType', () => {
  it('maps well-known scalar types', () => {
    expect(evmToPostgresType('bool')).toBe('boolean()')
    expect(evmToPostgresType('address')).toBe('char({ length: 42 })')
    expect(evmToPostgresType('tuple')).toBe('jsonb()')
  })

  it('falls back to jsonb() for array types', () => {
    expect(evmToPostgresType('tuple[]')).toBe('jsonb()')
    expect(evmToPostgresType('address[]')).toBe('jsonb()')
    expect(evmToPostgresType('uint256[]')).toBe('jsonb()')
    expect(evmToPostgresType('bytes32[5]')).toBe('jsonb()')
    expect(evmToPostgresType('string[]')).toBe('jsonb()')
  })

  it('throws DbMappingError for unknown non-array types', () => {
    expect(() => evmToPostgresType('fixedN')).toThrow(DbMappingError)
  })
})

describe('evmToClickhouseType', () => {
  it('maps well-known scalar types', () => {
    expect(evmToClickhouseType('bool')).toBe('Bool')
    expect(evmToClickhouseType('address')).toBe('LowCardinality(FixedString(42))')
    expect(evmToClickhouseType('tuple')).toBe('JSON')
  })

  it('falls back to JSON for array types', () => {
    expect(evmToClickhouseType('tuple[]')).toBe('JSON')
    expect(evmToClickhouseType('address[]')).toBe('JSON')
    expect(evmToClickhouseType('uint256[]')).toBe('JSON')
    expect(evmToClickhouseType('bytes32[5]')).toBe('JSON')
    expect(evmToClickhouseType('string[]')).toBe('JSON')
  })

  it('throws DbMappingError for unknown non-array types', () => {
    expect(() => evmToClickhouseType('nope')).toThrow(DbMappingError)
  })
})
