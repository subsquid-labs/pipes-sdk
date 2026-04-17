import { describe, expect, it } from 'vitest'

import type { DecoderGrouping } from '../../templates/pipes/evm/custom/decoder-grouping.js'
import { extractCreateTableNames, extractExportConstNames, tableName } from './shared.js'

describe('tableName', () => {
  it('returns snake-cased event name when grouping is shared', () => {
    const grouping: DecoderGrouping = { shared: true, groups: [] }
    expect(tableName(grouping, 'WETH9', 'Transfer')).toBe('transfer')
  })

  it('prefixes contract name when grouping is not shared', () => {
    const grouping: DecoderGrouping = { shared: false, groups: [] }
    expect(tableName(grouping, 'WETH9', 'Transfer')).toBe('weth_9_transfer')
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
