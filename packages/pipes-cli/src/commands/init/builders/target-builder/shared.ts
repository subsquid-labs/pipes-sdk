import { toSnakeCase } from 'drizzle-orm/casing'

import { RawAbiEvent } from '~/services/sqd-abi.js'
import { getEventSuffix } from '~/utils/event-signature.js'

import type { DecoderGrouping } from '../../templates/pipes/evm/custom/decoder-grouping.js'

export function tableName(
  grouping: DecoderGrouping,
  contractName: string,
  event: RawAbiEvent,
  allEvents: RawAbiEvent[],
): string {
  const base = grouping.shared ? toSnakeCase(event.name) : toSnakeCase(`${contractName}_${event.name}`)
  return isOverloaded(event, allEvents) ? `${base}_${getEventSuffix(event)}` : base
}

export function uniqueEventKey(event: RawAbiEvent, allEvents: RawAbiEvent[]): string {
  return isOverloaded(event, allEvents) ? `${event.name}_${getEventSuffix(event)}` : event.name
}

function isOverloaded(event: RawAbiEvent, allEvents: RawAbiEvent[]): boolean {
  return allEvents.filter((e) => e.name === event.name).length > 1
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
