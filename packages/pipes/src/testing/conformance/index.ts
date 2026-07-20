/**
 * Conformance harness (spec/13).
 *
 * The pieces are independent on purpose: ledger mode is usable without the oracle, the validators
 * without either, and the kill switch without any of them.
 *
 * `parquet-probe.js` is deliberately not re-exported — it pulls in `@dsnp/parquetjs`, which is a
 * peer dependency. Import it directly from a suite that already depends on Parquet.
 */
export {
  ChainLedger,
  type ChainLedgerOptions,
  type LedgerAdversary,
  type LedgerFault,
  type LedgerRequest,
  type LoggedRequest,
  buildChain,
} from './chain-ledger.js'
export { type Obstruction, expectCrash, obstruct, statePath, unitPath } from './kill-points.js'
export { type LedgerPortal, type LedgerPortalOptions, ledgerPortal } from './ledger-portal.js'
export {
  type Cursor,
  type DurabilityClass,
  ORACLE_ERRORS,
  OracleError,
  type OracleErrorCode,
  type OracleRow,
  type OracleState,
  type PersistedState,
  ReferenceModel,
  type ReferenceModelOptions,
  type RollbackRecord,
} from './reference-model.js'
export { type SinkProbe, allRows, dataBound } from './store-probe.js'
export {
  type Attributed,
  type DeliveredBatch,
  type PublishedUnit,
  type StructuralInput,
  type Violation,
  assertStructure,
  isAscendingChain,
  validateDecodable,
  validateInRange,
  validateItemsBelongToParent,
  validateLinked,
  validateOrdered,
  validateStructure,
  validateWatermarks,
} from './validators.js'
