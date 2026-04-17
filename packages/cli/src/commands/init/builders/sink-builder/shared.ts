import { toSnakeCase } from 'drizzle-orm/casing'

import type { DecoderGrouping } from '../../templates/pipes/evm/custom/decoder-grouping.js'

export function tableName(grouping: DecoderGrouping, contractName: string, eventName: string): string {
  return grouping.shared ? toSnakeCase(eventName) : toSnakeCase(`${contractName}_${eventName}`)
}

const EXPORT_CONST_NAME_REGEX = /^\s*export\s+const\s+([A-Za-z_$][\w$]*)\b/gm

export function extractExportConstNames(code: string): string[] {
  const names: string[] = []
  for (const m of code.matchAll(EXPORT_CONST_NAME_REGEX)) names.push(m[1])
  return [...new Set(names)]
}

const CREATE_TABLE_IF_NOT_EXISTS_NAME_REGEX = /^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gim

export function extractCreateTableNames(code: string): string[] {
  const names: string[] = []
  for (const m of code.trim().matchAll(CREATE_TABLE_IF_NOT_EXISTS_NAME_REGEX)) {
    names.push(m[1])
  }
  return [...new Set(names)]
}
