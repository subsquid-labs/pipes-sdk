import { describe, expect, it } from 'vitest'

import type { RawAbiEvent } from '~/services/sqd-abi.js'

import type { DecoderGrouping } from '../../templates/pipes/evm/custom/decoder-grouping.js'
import { extractCreateTableNames, extractExportConstNames, tableName, uniqueEventKey } from './shared.js'

const transfer3: RawAbiEvent = {
  name: 'Transfer',
  type: 'event',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
}

const approval3: RawAbiEvent = {
  name: 'Approval',
  type: 'event',
  inputs: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
}

const approval4: RawAbiEvent = {
  name: 'Approval',
  type: 'event',
  inputs: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

describe('tableName', () => {
  it('returns snake-cased event name when grouping is shared', () => {
    const grouping: DecoderGrouping = { shared: true, groups: [] }
    expect(tableName(grouping, 'WETH9', transfer3, [transfer3])).toBe('transfer')
  })

  it('prefixes contract name when grouping is not shared', () => {
    const grouping: DecoderGrouping = { shared: false, groups: [] }
    expect(tableName(grouping, 'WETH9', transfer3, [transfer3])).toBe('weth_9_transfer')
  })

  it('appends a signature suffix when the event name collides (overload)', () => {
    const grouping: DecoderGrouping = { shared: false, groups: [] }
    const allEvents = [transfer3, approval3, approval4]
    const first = tableName(grouping, 'Token', approval3, allEvents)
    const second = tableName(grouping, 'Token', approval4, allEvents)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^token_approval_[0-9a-f]{4}$/)
    expect(second).toMatch(/^token_approval_[0-9a-f]{4}$/)
  })

  it('does not append suffix when the event name is unique within the list', () => {
    const grouping: DecoderGrouping = { shared: false, groups: [] }
    expect(tableName(grouping, 'Token', transfer3, [transfer3, approval3])).toBe('token_transfer')
  })
})

describe('uniqueEventKey', () => {
  it('returns the bare name when no collision', () => {
    expect(uniqueEventKey(transfer3, [transfer3, approval3])).toBe('Transfer')
  })

  it('appends a signature suffix on collision', () => {
    const allEvents = [approval3, approval4]
    expect(uniqueEventKey(approval3, allEvents)).toMatch(/^Approval_[0-9a-f]{4}$/)
    expect(uniqueEventKey(approval3, allEvents)).not.toBe(uniqueEventKey(approval4, allEvents))
  })
})

describe('extractExportConstNames', () => {
  it('extracts names from exported const declarations', () => {
    const code = `
export const foo = 1
export const barBaz = 'x'
const notExported = 2
`
    expect(extractExportConstNames(code)).toEqual(['foo', 'barBaz'])
  })

  it('deduplicates repeated names', () => {
    const code = `export const dupe = 1\nexport const dupe = 2\n`
    expect(extractExportConstNames(code)).toEqual(['dupe'])
  })
})

describe('extractCreateTableNames', () => {
  it('extracts table names from CREATE TABLE IF NOT EXISTS statements', () => {
    const code = `
CREATE TABLE IF NOT EXISTS transfers (x Int);
CREATE TABLE IF NOT EXISTS approvals (y Int);
`
    expect(extractCreateTableNames(code)).toEqual(['transfers', 'approvals'])
  })

  it('handles varied whitespace and casing', () => {
    const code = `   create   table   if   not   exists   my_table (x Int);`
    expect(extractCreateTableNames(code)).toEqual(['my_table'])
  })

  it('deduplicates repeated table names', () => {
    const code = `
CREATE TABLE IF NOT EXISTS dupe (x Int);
CREATE TABLE IF NOT EXISTS dupe (y Int);
`
    expect(extractCreateTableNames(code)).toEqual(['dupe'])
  })
})
