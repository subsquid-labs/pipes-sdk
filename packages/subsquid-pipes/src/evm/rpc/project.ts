import { Block, DataRequest, FieldSelection } from '~/portal-client/query/evm.js'

/**
 * Augment a field selection with the fields a request's where-clauses need to *evaluate* — even
 * when not selected for output — so the filter engine can match on them (otherwise it sees
 * `undefined` and throws). Trace where-keys map 1:1 to trace field-selection keys; stateDiff
 * address/key/kind are always-present required fields. Mirrors the Squid evm-rpc-stream augment.
 */
export function augmentFields(fields: FieldSelection, req: DataRequest): FieldSelection {
  const log: any = { ...fields.log }
  const transaction: any = { ...fields.transaction }
  const trace: any = { ...fields.trace }

  for (const it of req.logs ?? []) {
    if (it.address) log.address = true
    if (it.topic0 || it.topic1 || it.topic2 || it.topic3) log.topics = true
  }
  for (const it of req.transactions ?? []) {
    if (it.to) transaction.to = true
    if (it.from) transaction.from = true
    if (it.sighash) transaction.sighash = true
    if (it.type) transaction.type = true
  }
  for (const it of req.traces ?? []) {
    if (it.createFrom) trace.createFrom = true
    if (it.callTo) trace.callTo = true
    if (it.callFrom) trace.callFrom = true
    if (it.callSighash) trace.callSighash = true
    if (it.suicideRefundAddress) trace.suicideRefundAddress = true
    if (it.rewardAuthor) trace.rewardAuthor = true
  }

  return { ...fields, log, transaction, trace }
}

const SELECTION_TYPES = ['block', 'transaction', 'log', 'trace', 'stateDiff'] as const

/** True if `augmented` selects any field that `original` does not (augmentation only adds). */
export function selectionGrew(augmented: FieldSelection, original: FieldSelection): boolean {
  for (const t of SELECTION_TYPES) {
    const aug = (augmented as any)[t] ?? {}
    const orig = (original as any)[t] ?? {}
    for (const k in aug) {
      if (aug[k] && !orig[k]) return true
    }
  }

  return false
}

const traceKey = (t: any) => `${t.transactionIndex}:${(t.traceAddress ?? []).join(',')}`
const stateDiffKey = (d: any) => `${d.transactionIndex}:${d.address}:${d.key}`

/** Keep only the items of `projected` whose structural index appears in the `filtered` block. */
export function projectKept(projected: Block<any>, filtered: Block<any>): Block<any> {
  const logs = new Set(filtered.logs.map((l: any) => l.logIndex))
  const transactions = new Set(filtered.transactions.map((t: any) => t.transactionIndex))
  const traces = new Set(filtered.traces.map(traceKey))
  const stateDiffs = new Set(filtered.stateDiffs.map(stateDiffKey))

  projected.logs = projected.logs.filter((l: any) => logs.has(l.logIndex))
  projected.transactions = projected.transactions.filter((t: any) => transactions.has(t.transactionIndex))
  projected.traces = projected.traces.filter((t: any) => traces.has(traceKey(t)))
  projected.stateDiffs = projected.stateDiffs.filter((d: any) => stateDiffs.has(stateDiffKey(d)))

  return projected
}
